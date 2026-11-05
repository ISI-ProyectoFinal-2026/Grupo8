import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from core.database import Base
from core.tiempo import ahora_utc


class Pago(Base):
    """Cada pago que informa Mercado Pago, aprobado o no.

    Si Mercado Pago avisa dos veces el mismo pago, se actualiza la misma fila
    (mp_payment_id es único).
    """
    __tablename__ = "pagos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Si se borra la reserva, el pago se conserva: es el registro de que entró la plata.
    # También queda nulo si el pago llega con una referencia que no es de ninguna reserva.
    reserva_id = Column(
        UUID(as_uuid=True), ForeignKey("reservas.id", ondelete="SET NULL"), index=True, nullable=True
    )
    mp_payment_id = Column(String(64), unique=True, nullable=False)

    # Estado tal cual lo informa Mercado Pago (approved, rejected, pending, in_process, refunded...)
    estado = Column(String(32), nullable=False)
    estado_detalle = Column(String(64), nullable=True)
    monto = Column(Numeric(12, 2), nullable=True)
    moneda = Column(String(3), nullable=True)
    metodo_pago = Column(String(32), nullable=True)

    # Fechas informadas por Mercado Pago, guardadas en UTC
    fecha_creacion = Column(DateTime(timezone=True), default=ahora_utc, nullable=False)
    fecha_aprobacion = Column(DateTime(timezone=True), nullable=True)

    # Respuesta de Mercado Pago sin datos del pagador ni de la tarjeta
    respuesta_mp = Column(JSONB, nullable=False)
