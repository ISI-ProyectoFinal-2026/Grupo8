from datetime import date
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from models.reserva import CondicionPersonaEnum
from models.tipo_reserva import FormaCobroEnum
from schemas.reserva import EDAD_MAXIMA


class PersonaCotizar(BaseModel):
    """Una persona de la cotización: con la edad y la condición alcanza para calcular su precio."""

    # strict: rechaza "34", 2.5 y True; solo enteros reales
    edad: int = Field(strict=True, ge=0, le=EDAD_MAXIMA)
    condicion: CondicionPersonaEnum


class CotizarRequest(BaseModel):
    # Opcional mientras la web no lo envíe: sin tipo se cotiza como antes de la Issue 19
    tipo_reserva_id: Optional[UUID] = None
    # Por persona (o sin tipo)
    personas: Optional[List[PersonaCotizar]] = None
    # Por unidad: cuántas personas van y las fechas, porque se cobra por noche
    cantidad_personas: Optional[int] = Field(default=None, strict=True, ge=1)
    fecha_ingreso: Optional[date] = None
    fecha_egreso: Optional[date] = None

    @field_validator("personas")
    @classmethod
    def validar_personas(cls, valor: Optional[List[PersonaCotizar]]) -> Optional[List[PersonaCotizar]]:
        # El máximo de personas se controla en el endpoint con la configuración guardada
        if valor is not None and len(valor) < 1:
            raise ValueError("Debe haber al menos 1 persona en la reserva.")
        return valor

    @model_validator(mode="after")
    def validar_datos_segun_forma(self):
        if self.personas is not None and self.cantidad_personas is not None:
            raise ValueError("Enviá las personas o la cantidad de personas, pero no las dos cosas.")
        if self.tipo_reserva_id is None and self.personas is None:
            raise ValueError("Debe haber al menos 1 persona en la reserva.")
        return self


class CotizarDetalle(BaseModel):
    """Cómo se llegó al precio de una persona."""

    indice: int  # posición de la persona en el request
    condicion_efectiva: CondicionPersonaEnum
    descuento_codigo: Optional[str] = None
    descuento_pct: float
    precio_base: float
    precio_final: float


class CotizarResponse(BaseModel):
    moneda: str = "ARS"
    subtotal: float
    descuento_total: float
    total: float
    cantidad_socios: int
    detalle: List[CotizarDetalle]
    # Solo cuando se cotiza con un tipo. Por unidad, el detalle va vacío: no hay precio por persona
    forma_cobro: Optional[FormaCobroEnum] = None
    precio_unitario: Optional[float] = None
    noches: Optional[int] = None
