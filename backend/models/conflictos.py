import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base
from core.tiempo import ahora_utc


class ConflictosSincronizacion(Base):
    __tablename__ = "conflictos_sincronizacion"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reserva_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    jti_involucrado = Column(String, nullable=False)
    motivo = Column(String, nullable=False)
    fecha_registro = Column(DateTime(timezone=True), default=ahora_utc)
    # Dispositivo que mandó el intento rechazado
    dispositivo_id = Column(String(64), nullable=True)