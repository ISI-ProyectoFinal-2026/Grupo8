import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation

import mercadopago
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.config import settings
from core.tiempo import a_utc, ahora_utc
from models.pago import Pago
from models.reserva import Reserva

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


# Instancia global para importar en los endpoints
payment_service = PaymentService()
