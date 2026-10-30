import uuid
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Boolean, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from core.database import Base
from core.tiempo import ahora_utc

class TipoIngresoEnum(enum.Enum):
    WEB = "Web"
    ESPONTANEO = "Espontáneo"

class IngresoFisico(Base):
    __tablename__ = "ingresos_fisicos"
    __table_args__ = (UniqueConstraint("jti", name="uq_ingresos_fisicos_jti"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    reserva_id = Column(UUID(as_uuid=True), ForeignKey("reservas.id", ondelete="CASCADE"), nullable=True)

    fecha_hora_ingreso = Column(DateTime(timezone=True), default=ahora_utc, index=True, nullable=False)
    tipo_ingreso = Column(Enum(TipoIngresoEnum), nullable=False)
    sincronizado_offline = Column(Boolean, default=False)

    # Ingreso manual en efectivo. Nullable para no romper filas existentes.
    jti = Column(String(64), nullable=True)
    cantidad_personas = Column(Integer, nullable=True)
    monto_cobrado = Column(Numeric(10, 2), nullable=True)
    nombre = Column(String(120), nullable=True)
    dni = Column(String(20), nullable=True)
    # Dispositivo (PWA) que registró el ingreso: permite distinguir un reenvío de un QR clonado
    dispositivo_id = Column(String(64), nullable=True)

    reserva = relationship("Reserva", back_populates="ingresos")