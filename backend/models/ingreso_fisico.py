import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from backend.core.database import Base

class TipoIngresoEnum(enum.Enum):
    WEB = "Web"
    ESPONTANEO = "Espontáneo"

class IngresoFisico(Base):
    __tablename__ = "ingresos_fisicos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reserva_id = Column(UUID(as_uuid=True), ForeignKey("reservas.id"), nullable=True)
    fecha_hora_ingreso = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    tipo_ingreso = Column(Enum(TipoIngresoEnum), nullable=False)
    sincronizado_offline = Column(Boolean, default=False)