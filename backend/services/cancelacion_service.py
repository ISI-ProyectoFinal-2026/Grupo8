"""Cancelación de reservas por parte del socio (Issue 22.2).

El socio puede cancelar una reserva pagada hasta N días antes del ingreso, y se le devuelve
por Mercado Pago el porcentaje que define el administrador (configuracion_camping).
"""
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Optional
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from core.tiempo import ahora_utc
from models.ingreso_fisico import IngresoFisico
from models.pago import DEVOLUCION_PENDIENTE_REVISION, DEVOLUCION_REALIZADA, Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from schemas.reserva import hoy_argentina
from services.camping_service import obtener_o_crear_camping
from services.email_service import email_service
from services.payment_service import reembolsar

logger = logging.getLogger(__name__)

CENTAVOS = Decimal("0.01")


class ReservaNoEncontradaError(Exception):
    """La reserva no existe o es de otro usuario: se responde igual para no revelar cuáles hay."""


class CancelacionNoPermitidaError(Exception):
    def __init__(self, mensaje: str):
        super().__init__(mensaje)
        self.mensaje = mensaje


@dataclass(frozen=True)
class CondicionesCancelacion:
    puede_cancelar: bool
    # Por qué no se puede cancelar; None si se puede
    motivo: Optional[str]
    # Último día (hora de Argentina) en que se puede cancelar
    fecha_limite: date
    dias_cancelacion: int
    porcentaje_devolucion: int
    monto_pagado: Decimal
    monto_a_devolver: Decimal


@dataclass(frozen=True)
class ResultadoCancelacion:
    reserva: Reserva
    condiciones: CondicionesCancelacion
    # False si Mercado Pago no pudo hacer la devolución: el pago queda para revisión
    devolucion_realizada: bool


def fecha_limite_cancelacion(fecha_ingreso: date, dias_cancelacion: int) -> date:
    """Con 1 día y el ingreso el 20/11, se puede cancelar hasta el 19/11 inclusive.
    Con 0 días, hasta el mismo día del ingreso."""
    return fecha_ingreso - timedelta(days=dias_cancelacion)


def calcular_monto_a_devolver(monto_pagado: Decimal, porcentaje: int) -> Decimal:
    """Porcentaje del monto pagado, redondeado hacia abajo al centavo para no devolver de más."""
    return (monto_pagado * Decimal(porcentaje) / Decimal(100)).quantize(CENTAVOS, rounding=ROUND_DOWN)


def mensaje_fuera_de_plazo(dias_cancelacion: int) -> str:
    if dias_cancelacion == 0:
        return "Lo sentimos, las reservas solo se pueden cancelar hasta el mismo día del ingreso."
    unidad = "día" if dias_cancelacion == 1 else "días"
    return f"Lo sentimos, las reservas solo se pueden cancelar hasta {dias_cancelacion} {unidad} antes del ingreso."


def formatear_pesos(monto: Decimal) -> str:
    """$ 12.345,67, como se escriben los importes en Argentina."""
    texto = f"{monto.quantize(CENTAVOS):,.2f}"
    return "$ " + texto.replace(",", "_").replace(".", ",").replace("_", ".")


def _motivo_para_no_cancelar(db: Session, reserva: Reserva, fecha_limite: date, dias: int, hoy: date) -> Optional[str]:
    if reserva.estado_reserva == EstadoReservaEnum.CANCELADA:
        return "La reserva ya está cancelada."
    if reserva.en_alerta:
        return "La reserva está en revisión y no se puede cancelar. Comunicate con la administración del camping."
    if reserva.estado_pago != EstadoPagoEnum.PAGADO:
        return "Solo se pueden cancelar reservas pagadas."
    if hoy > fecha_limite:
        return mensaje_fuera_de_plazo(dias)
    # Con 0 días se puede cancelar el mismo día del ingreso, salvo que alguien ya haya entrado
    ya_ingreso = db.query(IngresoFisico.id).filter(IngresoFisico.reserva_id == reserva.id).first()
    if ya_ingreso is not None:
        return "No se puede cancelar una reserva que ya registró un ingreso al camping."
    return None


def evaluar_cancelacion(db: Session, reserva: Reserva, hoy: Optional[date] = None) -> CondicionesCancelacion:
    """Si se puede cancelar la reserva, hasta cuándo y cuánto se devuelve, con la configuración actual."""
    camping = obtener_o_crear_camping(db)
    dias = camping.dias_cancelacion
    porcentaje = camping.porcentaje_devolucion
    fecha_limite = fecha_limite_cancelacion(reserva.fecha_ingreso, dias)
    monto_pagado = Decimal(str(reserva.monto_total)).quantize(CENTAVOS)
    motivo = _motivo_para_no_cancelar(db, reserva, fecha_limite, dias, hoy or hoy_argentina())
    return CondicionesCancelacion(
        puede_cancelar=motivo is None,
        motivo=motivo,
        fecha_limite=fecha_limite,
        dias_cancelacion=dias,
        porcentaje_devolucion=porcentaje,
        monto_pagado=monto_pagado,
        monto_a_devolver=calcular_monto_a_devolver(monto_pagado, porcentaje),
    )


def reserva_del_usuario(db: Session, reserva_id: UUID, usuario_id: UUID, bloquear: bool = False) -> Reserva:
    consulta = db.query(Reserva).filter(Reserva.id == reserva_id, Reserva.user_id == usuario_id)
    if bloquear:
        # Dos pedidos de cancelación a la vez no pueden devolver el dinero dos veces
        consulta = consulta.populate_existing().with_for_update()
    reserva = consulta.first()
    if reserva is None:
        raise ReservaNoEncontradaError()
    return reserva


def _pago_aprobado(db: Session, reserva: Reserva) -> Optional[Pago]:
    return (
        db.query(Pago)
        .filter(Pago.reserva_id == reserva.id, Pago.estado == "approved")
        .order_by(Pago.fecha_aprobacion.desc().nullslast())
        .first()
    )


def _devolver(db: Session, reserva: Reserva, condiciones: CondicionesCancelacion) -> bool:
    """Pide la devolución a Mercado Pago y la registra en pagos. No hace commit."""
    monto = condiciones.monto_a_devolver
    pago = _pago_aprobado(db, reserva)

    if monto == 0:
        # Con 0 % no hay nada que devolver
        realizada = True
    elif pago is None:
        logger.error(f"La reserva {reserva.id} se canceló pero no tiene un pago aprobado registrado para devolver.")
        realizada = False
    else:
        # Con el 100 % se pide la devolución total, así Mercado Pago marca el pago como devuelto
        total = condiciones.porcentaje_devolucion == 100
        realizada = reembolsar(pago.mp_payment_id, None if total else monto)
        if realizada and total:
            pago.estado = "refunded"

    if pago is not None:
        pago.monto_devuelto = monto
        pago.devolucion_estado = DEVOLUCION_REALIZADA if realizada else DEVOLUCION_PENDIENTE_REVISION
        pago.fecha_devolucion = ahora_utc() if realizada else None

    if not realizada:
        logger.error(
            f"Reserva {reserva.id} cancelada por el socio: no se pudo devolver {monto}. "
            "Hay que devolverlo a mano desde Mercado Pago."
        )
    return realizada


def _programar_correo(
    reserva: Reserva, condiciones: CondicionesCancelacion, realizada: bool, background_tasks: BackgroundTasks
) -> None:
    monto = formatear_pesos(condiciones.monto_a_devolver)
    if condiciones.monto_a_devolver == 0:
        detalle = "Según las condiciones de cancelación del camping, esta cancelación no tiene devolución."
    elif realizada:
        detalle = (
            f"Te devolvimos {monto} ({condiciones.porcentaje_devolucion} % de lo que pagaste) por Mercado Pago. "
            "Puede tardar unos días en verse reflejado según tu medio de pago."
        )
    else:
        detalle = (
            f"Estamos procesando la devolución de {monto} ({condiciones.porcentaje_devolucion} % de lo que pagaste) "
            "por Mercado Pago. Si tenés alguna duda, comunicate con la administración del camping."
        )
    background_tasks.add_task(
        email_service.enviar_cancelacion_sync,
        destinatario=reserva.email,
        datos_reserva={
            "nombre_cliente": reserva.titular,
            "reserva_id": str(reserva.id),
            "motivo_cancelacion": "Cancelaste la reserva desde Mis reservas.",
            "detalle_devolucion": detalle,
        },
    )


def cancelar_reserva(
    db: Session,
    reserva_id: UUID,
    usuario_id: UUID,
    background_tasks: BackgroundTasks,
    hoy: Optional[date] = None,
) -> ResultadoCancelacion:
    """
    Cancela la reserva del socio y le devuelve el porcentaje que corresponde.

    La reserva pasa a CANCELADA (libera el cupo y su QR entra en la lista de canceladas de la PWA)
    aunque falle la devolución: en ese caso el pago queda marcado para revisión. El estado del
    pago sigue en PAGADO, así un aviso posterior de Mercado Pago no vuelve a confirmarla.
    """
    reserva = reserva_del_usuario(db, reserva_id, usuario_id, bloquear=True)
    condiciones = evaluar_cancelacion(db, reserva, hoy)
    if not condiciones.puede_cancelar:
        db.rollback()  # libera el bloqueo
        raise CancelacionNoPermitidaError(condiciones.motivo or "No se puede cancelar la reserva.")

    reserva.cambiar_estado_reserva(EstadoReservaEnum.CANCELADA)
    realizada = _devolver(db, reserva, condiciones)
    db.commit()

    _programar_correo(reserva, condiciones, realizada, background_tasks)
    return ResultadoCancelacion(reserva=reserva, condiciones=condiciones, devolucion_realizada=realizada)
