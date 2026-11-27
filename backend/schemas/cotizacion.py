from datetime import date
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from models.reserva import CondicionPersonaEnum
from models.tipo_reserva import FormaCobroEnum
from schemas.reserva import EDAD_MAXIMA, DniOpcional


class PersonaCotizar(BaseModel):
    """Una persona de la cotización: con la edad y la condición alcanza para calcular su precio."""

    # strict: rechaza "34", 2.5 y True; solo enteros reales
    edad: int = Field(strict=True, ge=0, le=EDAD_MAXIMA)
    condicion: CondicionPersonaEnum


class CotizarRequest(BaseModel):
    # Opcional mientras la web no lo envíe: sin tipo se cotiza solo por persona, como antes de existir los tipos de reserva
    tipo_reserva_id: Optional[UUID] = None
    # Por persona (o sin tipo)
    personas: Optional[List[PersonaCotizar]] = None
    # Por unidad: cuántas personas van, y las fechas porque se cobra por noche. Por persona las fechas
    # también cuentan (precio × personas × noches); sin ellas se cotiza una jornada
    cantidad_personas: Optional[int] = Field(default=None, strict=True, ge=1)
    fecha_ingreso: Optional[date] = None
    fecha_egreso: Optional[date] = None
    # Por unidad (cabaña): DNI del titular si reserva como socio. Si valida, se descuenta
    dni_titular: DniOpcional = None

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
        if self.personas is not None and self.dni_titular is not None:
            raise ValueError("El DNI del titular es solo para reservas por unidad.")
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
    # Solo por unidad: porcentaje de descuento de socio aplicado (nulo si el titular no es socio)
    descuento_pct: Optional[float] = None
    # Solo por persona: las noches que se cobraron a cada una (0 noches, visita por el día, cuenta 1)
    jornadas: Optional[int] = None
