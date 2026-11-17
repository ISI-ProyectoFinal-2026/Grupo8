"""Cancelación de reservas (Issues 22.2 y 25.1).

Una reserva pagada se puede cancelar hasta N días antes del ingreso, y se devuelve por Mercado Pago
el porcentaje que define el administrador (configuracion_camping).

Por encima de esa regla está el derecho de arrepentimiento: dentro de los primeros días corridos desde
que se hizo la reserva (ARREPENTIMIENTO_DIAS) y hasta el día anterior al ingreso, se puede cancelar
siempre y se devuelve el total.
"""
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Optional
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from core.config import settings
from core.tiempo import a_zona_negocio, ahora_utc
from models.ingreso_fisico import IngresoFisico
from models.pago import DEVOLUCION_PENDIENTE_REVISION, DEVOLUCION_REALIZADA, Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from schemas.reserva import CancelacionCondiciones, CancelacionResultado, ReservaResponse, hoy_argentina
from services.camping_service import obtener_o_crear_camping
from services.email_service import email_service
from services.payment_service import reembolsar

logger = logging.getLogger(__name__)

CENTAVOS = Decimal("0.01")

MOTIVO_MIS_RESERVAS = "Cancelaste la reserva desde Mis reservas."


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
    # Último día (hora de Argentina) en que se puede cancelar con estas condiciones
    fecha_limite: date
    dias_cancelacion: int
    porcentaje_devolucion: int
    monto_pagado: Decimal
    monto_a_devolver: Decimal
    # True si rige el arrepentimiento en lugar de las reglas del camping
    arrepentimiento: bool


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


def fin_arrepentimiento(fecha_reserva: datetime, fecha_ingreso: date) -> date:
    """Último día en que se puede cancelar por arrepentimiento: el día N contado desde la reserva o el
    día anterior al ingreso, lo que llegue primero. El día de la reserva no cuenta (art. 6 del CCyC):
    con 10 días, una reserva del 1/11 se puede cancelar hasta el 11/11 inclusive."""
    # fecha_reserva se guarda en UTC sin zona: una reserva de las 22 h en Argentina ya es del día siguiente en UTC
    dia_reserva = a_zona_negocio(fecha_reserva).date()
    return min(dia_reserva + timedelta(days=settings.ARREPENTIMIENTO_DIAS), fecha_ingreso - timedelta(days=1))


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
    hoy = hoy or hoy_argentina()
    dias = camping.dias_cancelacion
    limite_arrepentimiento = fin_arrepentimiento(reserva.fecha_reserva, reserva.fecha_ingreso)
    arrepentimiento = hoy <= limite_arrepentimiento
    if arrepentimiento:
        porcentaje = 100
        fecha_limite = limite_arrepentimiento
    else:
        porcentaje = camping.porcentaje_devolucion
        fecha_limite = fecha_limite_cancelacion(reserva.fecha_ingreso, dias)
    monto_pagado = Decimal(str(reserva.monto_total)).quantize(CENTAVOS)
    motivo = _motivo_para_no_cancelar(db, reserva, fecha_limite, dias, hoy)
    return CondicionesCancelacion(
        puede_cancelar=motivo is None,
        motivo=motivo,
        fecha_limite=fecha_limite,
        dias_cancelacion=dias,
        porcentaje_devolucion=porcentaje,
        monto_pagado=monto_pagado,
        monto_a_devolver=calcular_monto_a_devolver(monto_pagado, porcentaje),
        arrepentimiento=arrepentimiento,
    )


def reserva_del_usuario(db: Session, reserva_id: UUID, usuario_id: UUID) -> Reserva:
    """La reserva del socio, para cancelarla desde Mis reservas."""
    reserva = db.query(Reserva).filter(Reserva.id == reserva_id, Reserva.user_id == usuario_id).first()
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
            f"Reserva {reserva.id} cancelada: no se pudo devolver {monto}. "
            "Hay que devolverlo a mano desde Mercado Pago."
        )
    return realizada


def _programar_correo(
    reserva: Reserva,
    condiciones: CondicionesCancelacion,
    realizada: bool,
    motivo: str,
    background_tasks: BackgroundTasks,
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
    if condiciones.arrepentimiento:
        detalle = "Cancelaste dentro del plazo de arrepentimiento, por eso se te devuelve el total. " + detalle
    background_tasks.add_task(
        email_service.enviar_cancelacion_sync,
        destinatario=reserva.email,
        datos_reserva={
            "nombre_cliente": reserva.titular,
            "reserva_id": str(reserva.id),
            # El id de la reserva es el código de gestión de la cancelación
            "codigo_gestion": str(reserva.id),
            "motivo_cancelacion": motivo,
            "detalle_devolucion": detalle,
        },
    )


def cancelar_reserva(
    db: Session,
    reserva: Reserva,
    background_tasks: BackgroundTasks,
    motivo: str = MOTIVO_MIS_RESERVAS,
    hoy: Optional[date] = None,
) -> ResultadoCancelacion:
    """
    Cancela una reserva ya encontrada (por su dueño en Mis reservas, o por el enlace del botón de
    arrepentimiento) y devuelve el porcentaje que corresponde. `motivo` es el que figura en el correo.

    La reserva pasa a CANCELADA (libera el cupo y su QR entra en la lista de canceladas de la PWA)
    aunque falle la devolución: en ese caso el pago queda marcado para revisión. El estado del
    pago sigue en PAGADO, así un aviso posterior de Mercado Pago no vuelve a confirmarla.
    """
    # Bloquea la fila y la vuelve a leer: dos pedidos a la vez no pueden devolver el dinero dos veces
    db.refresh(reserva, with_for_update=True)
    condiciones = evaluar_cancelacion(db, reserva, hoy)
    if not condiciones.puede_cancelar:
        db.rollback()  # libera el bloqueo
        raise CancelacionNoPermitidaError(condiciones.motivo or "No se puede cancelar la reserva.")

    reserva.cambiar_estado_reserva(EstadoReservaEnum.CANCELADA)
    realizada = _devolver(db, reserva, condiciones)
    db.commit()

    _programar_correo(reserva, condiciones, realizada, motivo, background_tasks)
    return ResultadoCancelacion(reserva=reserva, condiciones=condiciones, devolucion_realizada=realizada)


def condiciones_out(condiciones: CondicionesCancelacion) -> CancelacionCondiciones:
    return CancelacionCondiciones(
        puede_cancelar=condiciones.puede_cancelar,
        dias_minimos=condiciones.dias_cancelacion,
        fecha_limite=condiciones.fecha_limite,
        porcentaje_devolucion=condiciones.porcentaje_devolucion,
        monto_devolucion=float(condiciones.monto_a_devolver),
        mensaje=condiciones.motivo,
        arrepentimiento=condiciones.arrepentimiento,
    )


def resultado_out(resultado: ResultadoCancelacion) -> CancelacionResultado:
    """La reserva ya cancelada, lo que se devolvió y el mensaje para mostrar."""
    condiciones = resultado.condiciones
    monto = formatear_pesos(condiciones.monto_a_devolver)
    if condiciones.monto_a_devolver == 0:
        mensaje = "La reserva quedó cancelada. Según las condiciones del camping, no corresponde devolución."
    elif resultado.devolucion_realizada:
        mensaje = f"La reserva quedó cancelada. Te devolvimos {monto} por Mercado Pago."
    else:
        mensaje = (
            f"La reserva quedó cancelada. Estamos procesando la devolución de {monto}; "
            "te avisamos por correo."
        )
    reserva = ReservaResponse.model_validate(resultado.reserva).model_dump()
    return CancelacionResultado(
        **reserva,
        monto_devuelto=float(condiciones.monto_a_devolver),
        devolucion_realizada=resultado.devolucion_realizada,
        mensaje=mensaje,
    )
