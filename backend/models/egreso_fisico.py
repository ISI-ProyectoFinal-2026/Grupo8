import uuid

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base
from core.tiempo import ahora_utc


class EgresoFisico(Base):
    """Una fila por cada salida del camping que registra el administrador."""
    __tablename__ = "egresos_fisicos"
    __table_args__ = (
        CheckConstraint("cantidad_personas >= 1", name="ck_egresos_fisicos_cantidad_positiva"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cantidad_personas = Column(Integer, nullable=False)
    # Se guarda en UTC, igual que la hora de los ingresos
    fecha_hora_egreso = Column(DateTime(timezone=True), default=ahora_utc, index=True, nullable=False)
    # Sin cascada: no se puede borrar un administrador que registró egresos
    registrado_por_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), index=True, nullable=False)