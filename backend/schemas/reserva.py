from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Optional
from datetime import date, datetime
from uuid import UUID

from models.reserva import EstadoPagoEnum, EstadoReservaEnum

class ReservaCreate(BaseModel):
    user_id: UUID
    fecha_ingreso: date
    fecha_egreso: date
    cantidad_personas: int
    titular: str = Field(min_length=1)
    # Validación simple de formato, sin sumar la dependencia de email-validator
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    telefono: str = Field(min_length=1)

    @model_validator(mode="after")
    def validar_fechas(self):
        if self.fecha_egreso < self.fecha_ingreso:
            raise ValueError("La fecha de egreso no puede ser anterior a la de ingreso.")
        return self

class ReservaResponse(BaseModel):
    id: UUID
    user_id: UUID
    camping_id: str
    fecha_reserva: datetime
    fecha_ingreso: date
    fecha_egreso: date
    cantidad_personas: int
    monto_total: float
    titular: str
    email: str
    telefono: Optional[str] = None
    estado_reserva: EstadoReservaEnum
    estado_pago: EstadoPagoEnum
    jwt_jti: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
