from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from core.config import settings
from models.reserva import CondicionPersonaEnum
from schemas.reserva import EDAD_MAXIMA


class PersonaCotizar(BaseModel):
    """Una persona de la cotización: con la edad y la condición alcanza para calcular su precio."""

    # strict: rechaza "34", 2.5 y True; solo enteros reales
    edad: int = Field(strict=True, ge=0, le=EDAD_MAXIMA)
    condicion: CondicionPersonaEnum


class CotizarRequest(BaseModel):
    personas: List[PersonaCotizar]

    @field_validator("personas")
    @classmethod
    def validar_personas(cls, valor: List[PersonaCotizar]) -> List[PersonaCotizar]:
        maximo = settings.MAX_PERSONAS_POR_RESERVA
        if len(valor) < 1:
            raise ValueError("Debe haber al menos 1 persona en la reserva.")
        if len(valor) > maximo:
            raise ValueError(f"La cantidad máxima de personas por reserva es {maximo}.")
        return valor


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
