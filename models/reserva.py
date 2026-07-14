import uuid
import enum
from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base

class EstadoPagoEnum(enum.Enum):
    PENDIENTE = "Pendiente"
    PAGADO = "Pagado"
    CANCELADO = "Cancelado"

class Reserva(Base):
    __tablename__ = "reservas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    fecha_reserva = Column(DateTime, nullable=False)
    cantidad_personas = Column(Integer, nullable=False)
    estado_pago = Column(Enum(EstadoPagoEnum), default=EstadoPagoEnum.PENDIENTE, nullable=False)
    
    # Identificador único del QR
    jwt_jti = Column(String, unique=True, index=True, nullable=True)