import enum
import logging
import time
import uuid
from datetime import datetime, time as dtime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import mercadopago
from fastapi import BackgroundTasks
from mercadopago.webhook import InvalidWebhookSignatureError, WebhookSignatureValidator
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.config import settings
from core.tiempo import a_utc, ahora_utc
from models.pago import Pago
from models.reserva import CondicionPersonaEnum, EstadoPagoEnum, Reserva
from security.schemas import JWTPayloadSchema
from security.services import SecurityService
from services.email_service import email_service

logger = logging.getLogger(__name__)

ZONA_ARGENTINA = ZoneInfo("America/Argentina/Buenos_Aires")

# Campos de la respuesta de Mercado Pago que se guardan en pagos.respuesta_mp.
# Es una lista de permitidos: cualquier campo nuevo que agregue Mercado Pago queda afuera
# hasta que se revise. Así nunca se guardan payer, card, additional_info (trae datos del
# pagador y su IP) ni point_of_interaction (puede traer datos bancarios).
CAMPOS_RESPUESTA_MP = {
    "id",
    "status",
    "status_detail",
    "external_reference",
    "transaction_amount",
    "transaction_amount_refunded",
    "currency_id",
    "payment_method_id",
    "payment_type_id",
    "installments",
    "operation_type",
    "live_mode",
    "date_created",
    "date_approved",
    "date_last_updated",
    "money_release_date",
    "collector_id",
    "issuer_id",
    "captured",
}

# De transaction_details solo se guardan los importes
CAMPOS_DETALLE_TRANSACCION = {
    "total_paid_amount",
    "net_received_amount",
    "installment_amount",
    "overpaid_amount",
}


class PaymentService:
    def __init__(self):
        # Inicializamos el SDK con el Access Token de las variables de entorno
        self.mp = mercadopago.SDK(settings.MERCADOPAGO_ACCESS_TOKEN)


def limpiar_respuesta_mp(respuesta: dict) -> dict:
    """Deja solo los datos del pago, sin datos del pagador ni de la tarjeta."""
    limpia = {clave: valor for clave, valor in respuesta.items() if clave in CAMPOS_RESPUESTA_MP}
    detalle = respuesta.get("transaction_details")
    if isinstance(detalle, dict):
        limpia["transaction_details"] = {
            clave: valor for clave, valor in detalle.items() if clave in CAMPOS_DETALLE_TRANSACCION
        }
    return limpia


def _fecha_utc(valor) -> datetime | None:
    # Mercado Pago manda las fechas en ISO 8601 con zona (ej: 2026-11-04T20:15:00.000-04:00)
    if not isinstance(valor, str):
        return None
    try:
        return a_utc(datetime.fromisoformat(valor))
    except ValueError:
        return None


def _monto(valor) -> Decimal | None:
    if valor is None or isinstance(valor, bool):
        return None
    try:
        return Decimal(str(valor))
    except InvalidOperation:
        return None


def _reserva_existente(db: Session, external_reference) -> uuid.UUID | None:
    """El external_reference es el id de la reserva; si no corresponde a ninguna, queda nulo."""
    try:
        reserva_id = uuid.UUID(str(external_reference))
    except ValueError:
        return None
    existe = db.query(Reserva.id).filter(Reserva.id == reserva_id).first()
    return reserva_id if existe else None


def registrar_pago(db: Session, datos_mp: dict) -> Pago | None:
    """Guarda o actualiza el pago en la tabla pagos. No hace commit.

    Si el pago ya estaba registrado (Mercado Pago avisa varias veces el mismo pago,
    o lo informan el webhook y la reconciliación), se actualiza la misma fila.
    Devuelve None si la respuesta no trae el id del pago.
    """
    mp_payment_id = datos_mp.get("id")
    if mp_payment_id is None or mp_payment_id == "":
        return None

    valores = {
        "reserva_id": _reserva_existente(db, datos_mp.get("external_reference")),
        "estado": str(datos_mp.get("status") or "desconocido"),
        "estado_detalle": datos_mp.get("status_detail"),
        "monto": _monto(datos_mp.get("transaction_amount")),
        "moneda": datos_mp.get("currency_id"),
        "metodo_pago": datos_mp.get("payment_method_id"),
        "fecha_creacion": _fecha_utc(datos_mp.get("date_created")) or ahora_utc(),
        "fecha_aprobacion": _fecha_utc(datos_mp.get("date_approved")),
        "respuesta_mp": limpiar_respuesta_mp(datos_mp),
    }

    # Insertar o actualizar en una sola sentencia: si el webhook y la reconciliación
    # llegan a la vez, no se crean dos filas para el mismo pago.
    # La fecha de creación no se pisa al actualizar.
    sentencia = insert(Pago).values(id=uuid.uuid4(), mp_payment_id=str(mp_payment_id), **valores)
    sentencia = sentencia.on_conflict_do_update(
        index_elements=[Pago.mp_payment_id],
        set_={campo: sentencia.excluded[campo] for campo in valores if campo != "fecha_creacion"},
    ).returning(Pago.id)
    pago_id = db.execute(sentencia).scalar_one()
    return db.get(Pago, pago_id, populate_existing=True)


def tipo_qr(reserva: Reserva) -> str:
    """El QR sale como socio solo si todas las personas de la reserva son socias.
    Con algún visitante, o en reservas anteriores a la carga de personas, sale como visitante."""
    personas = reserva.personas
    if personas and all(persona.condicion == CondicionPersonaEnum.socio for persona in personas):
        return "socio"
    return "visitante"


def _programar_correo_con_qr(reserva: Reserva, background_tasks: BackgroundTasks) -> None:
    # El QR vence al terminar el día de egreso (hora de Argentina)
    vencimiento = datetime.combine(reserva.fecha_egreso + timedelta(days=1), dtime.min, tzinfo=ZONA_ARGENTINA)
    payload = JWTPayloadSchema(
        jti=str(uuid.uuid4()),
        reserva_id=str(reserva.id),
        camping_id=reserva.camping_id,
        iat=int(time.time()),
        cantidad_personas=reserva.cantidad_personas,
        typ=tipo_qr(reserva),
        exp=int(vencimiento.timestamp()),
        dat=reserva.fecha_ingreso.isoformat(),
    )
    jwt_generado = SecurityService().generate_offline_qr_token(payload)

    datos_html = {
        "reserva_id": str(reserva.id),
        "nombre_cliente": reserva.titular,
        "email": reserva.email,
        "fecha_ingreso": str(reserva.fecha_ingreso),
        "cantidad_personas": reserva.cantidad_personas,
    }
    # El correo se manda después de responder, para no demorar la respuesta
    background_tasks.add_task(
        email_service.enviar_confirmacion_sync,
        destinatario=reserva.email,
        datos_reserva=datos_html,
        jwt_token=jwt_generado,
    )


def aviso_autentico(x_signature: str | None, x_request_id: str | None, data_id: str | None) -> bool:
    """Valida la firma x-signature de un aviso de Mercado Pago con la clave secreta del webhook."""
    secreto = settings.MERCADOPAGO_WEBHOOK_SECRET
    if not secreto:
        logger.error("MERCADOPAGO_WEBHOOK_SECRET no está configurada: se rechaza el aviso de Mercado Pago.")
        return False
    try:
        WebhookSignatureValidator.validate(x_signature, x_request_id, data_id, secreto)
    except InvalidWebhookSignatureError as e:
        logger.warning(f"Aviso de Mercado Pago rechazado ({e.reason.value}), request-id: {e.request_id}")
        return False
    return True


def importe_coincide(reserva: Reserva, monto_cobrado) -> bool:
    """Compara al centavo lo que cobró Mercado Pago con el monto_total de la reserva."""
    cobrado = _monto(monto_cobrado)
    if cobrado is None:
        return False
    centavos = Decimal("0.01")
    return cobrado.quantize(centavos) == Decimal(str(reserva.monto_total)).quantize(centavos)


class ResultadoConfirmacion(str, enum.Enum):
    CONFIRMADA = "confirmada"
    YA_PAGADA = "ya_pagada"
    NO_ENCONTRADA = "no_encontrada"
    IMPORTE_DISTINTO = "importe_distinto"


def confirmar_pago(
    db: Session, reserva_id, background_tasks: BackgroundTasks, monto_cobrado
) -> ResultadoConfirmacion:
    """Marca la reserva como pagada y programa el correo con el QR.

    Lo usan el webhook y la reconciliación. El correo sale solo cuando la reserva pasa
    a pagada: si ya lo estaba (aviso repetido o reconciliación posterior), no se hace nada.
    Si el importe cobrado no coincide con el de la reserva, no se confirma: el pago ya
    quedó registrado en la tabla pagos para revisarlo.
    """
    try:
        reserva_uuid = uuid.UUID(str(reserva_id))
    except ValueError:
        return ResultadoConfirmacion.NO_ENCONTRADA

    # El bloqueo evita que el webhook y la reconciliación confirmen (y manden el correo) a la vez
    reserva = (
        db.query(Reserva)
        .filter(Reserva.id == reserva_uuid)
        .populate_existing()
        .with_for_update()
        .first()
    )
    if reserva is None:
        db.rollback()  # libera el bloqueo
        return ResultadoConfirmacion.NO_ENCONTRADA
    if reserva.estado_pago == EstadoPagoEnum.PAGADO:
        db.rollback()
        return ResultadoConfirmacion.YA_PAGADA
    if not importe_coincide(reserva, monto_cobrado):
        logger.warning(
            f"Importe distinto en la reserva {reserva.id}: Mercado Pago cobró {monto_cobrado}, "
            f"la reserva es de {reserva.monto_total}. No se confirma; el pago queda para revisión."
        )
        db.rollback()
        return ResultadoConfirmacion.IMPORTE_DISTINTO

    reserva.marcar_como_pagada()
    db.commit()

    # La reserva ya quedó pagada: si falla el QR o el correo, no se deshace el pago
    try:
        _programar_correo_con_qr(reserva, background_tasks)
    except Exception as e:
        logger.error(f"No se pudo generar el QR de la reserva {reserva.id}: {e}")
    return ResultadoConfirmacion.CONFIRMADA


# Instancia global para importar en los endpoints
payment_service = PaymentService()
