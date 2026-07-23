from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from uuid import UUID

from models.reserva import EstadoPagoEnum

class ReservaBase(BaseModel):
    fecha_reserva: datetime
    cantidad_personas: int

class ReservaCreate(ReservaBase):
    user_id: UUID

class ReservaResponse(ReservaBase):
    id: UUID
    user_id: UUID
    estado_pago: EstadoPagoEnum
    jwt_jti: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)