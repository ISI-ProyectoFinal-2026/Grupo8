import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID

from core.database import Base
from models.reserva import EstadoReservaEnum


class ResolucionAlerta(Base):
    """Auditoría: una fila por cada incidente de clonación que un administrador resolvió."""
    __tablename__ = "resoluciones_alerta"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reserva_id = Column(
        UUID(as_uuid=True), ForeignKey("reservas.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Sin cascada: no se puede borrar un usuario que resolvió incidentes
    resuelto_por_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), index=True, nullable=False)

    # Cuándo se detectó el incidente (se copia de la reserva antes de limpiarla)
    fecha_deteccion = Column(DateTime, nullable=True)
    fecha_resolucion = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    estado_restaurado = Column(Enum(EstadoReservaEnum), nullable=False)
    nota = Column(String(500), nullable=True)