import uuid
from sqlalchemy import Column, Integer, Float, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base

class ConfiguracionCamping(Base):
    __tablename__ = "configuracion_camping"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Usamos String para el camping_id por si en el futuro usan nombres o códigos (ej: "CAMP-MENDOZA-01")
    camping_id = Column(String, nullable=False) 
    capacidad_total = Column(Integer, nullable=False)
    porcentaje_buffer_offline = Column(Integer, nullable=False)
    max_personas_por_reserva = Column(Integer, nullable=False)
    precio_base_actual = Column(Float, nullable=False)
    # Reglas de cancelación: hasta cuántos días antes del ingreso se puede cancelar y qué porcentaje se devuelve
    dias_cancelacion = Column(Integer, nullable=False, server_default="1")
    porcentaje_devolucion = Column(Integer, nullable=False, server_default="100")

    # Acá está la restricción (Constraint/Unique) que pide el DoD
    __table_args__ = (
        UniqueConstraint('camping_id', name='uq_unica_config_por_camping'),
    )