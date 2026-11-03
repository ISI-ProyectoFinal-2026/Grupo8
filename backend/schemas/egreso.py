from datetime import datetime
from typing import Annotated, Optional
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field

from core.tiempo import a_utc

# Igual que la hora de escaneo (16.4): tiene que traer zona horaria y se pasa a UTC
FechaConZona = Annotated[datetime, AfterValidator(a_utc)]


class EgresoCreate(BaseModel):
    cantidad_personas: int = Field(..., ge=1)
    # Si no se manda, se toma la hora en que llega el pedido
    fecha_hora_egreso: Optional[FechaConZona] = None


class EgresoOut(BaseModel):
    id: UUID
    cantidad_personas: int
    fecha_hora_egreso: datetime
    registrado_por_id: UUID
    # Personas que quedan dentro después de registrar este egreso
    personas_dentro: int