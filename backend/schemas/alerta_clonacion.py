from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer, field_validator

from models.reserva import EstadoReservaEnum


class AlertaClonacionOut(BaseModel):
    reserva_id: UUID
    titular: str
    fecha_ingreso: date
    fecha_alerta_clonacion: Optional[datetime]

    @field_serializer("fecha_alerta_clonacion")
    def _serializar_fecha(self, valor: Optional[datetime]) -> Optional[str]:
        # La base guarda esta fecha en UTC sin zona. Se envía con la zona para que el
        # navegador la muestre en la hora local correcta y no corrida tres horas.
        if valor is None:
            return None
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=timezone.utc)
        return valor.isoformat()


class ResolverAlertaIn(BaseModel):
    nota: Optional[str] = Field(default=None, max_length=500)

    @field_validator("nota")
    @classmethod
    def _limpiar_nota(cls, valor: Optional[str]) -> Optional[str]:
        if valor is None:
            return None
        return valor.strip() or None


class ResolucionAlertaOut(BaseModel):
    reserva_id: UUID
    estado_restaurado: EstadoReservaEnum
    resuelto_por_id: UUID
    resuelto_por_nombre: str
    fecha_resolucion: datetime