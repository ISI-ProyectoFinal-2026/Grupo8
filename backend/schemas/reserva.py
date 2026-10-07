import re
from datetime import date, datetime
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from core.config import settings
from models.reserva import EstadoPagoEnum, EstadoReservaEnum

ZONA_HORARIA = ZoneInfo("America/Argentina/Buenos_Aires")

FECHA_ISO_REGEX = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Letras (con acentos), separadas por espacios, puntos, apóstrofes o guiones
NOMBRE_REGEX = re.compile(r"^[^\W\d_]+(?:[ .'’\-]+[^\W\d_]+)*\.?$")
TELEFONO_REGEX = re.compile(r"^[0-9]+$")


def hoy_argentina() -> date:
    """'Hoy' según la hora del camping, no la del servidor."""
    return datetime.now(ZONA_HORARIA).date()


class ReservaCreate(BaseModel):
    # Se recortan espacios al inicio/fin de todos los textos antes de validar
    model_config = ConfigDict(str_strip_whitespace=True)

    user_id: UUID
    fecha_ingreso: date
    fecha_egreso: date
    # strict: rechaza "2", 2.5 y True; solo enteros reales
    cantidad_personas: int = Field(strict=True)
    titular: str
    # EmailStr usa email-validator (sin chequeo DNS por defecto)
    email: EmailStr
    telefono: str

    @field_validator("fecha_ingreso", "fecha_egreso", mode="before")
    @classmethod
    def validar_formato_fecha(cls, valor):
        # Evita que Pydantic acepte timestamps numéricos u otros formatos ambiguos
        if isinstance(valor, str):
            valor = valor.strip()
            if not FECHA_ISO_REGEX.match(valor):
                raise ValueError("La fecha debe tener formato AAAA-MM-DD.")
            try:
                return date.fromisoformat(valor)
            except ValueError:
                raise ValueError("La fecha ingresada no existe en el calendario.")
        if isinstance(valor, date):
            return valor
        raise ValueError("La fecha debe tener formato AAAA-MM-DD.")

    @field_validator("cantidad_personas")
    @classmethod
    def validar_cantidad_personas(cls, valor: int) -> int:
        maximo = settings.MAX_PERSONAS_POR_RESERVA
        if valor < 1:
            raise ValueError("Debe haber al menos 1 persona en la reserva.")
        if valor > maximo:
            raise ValueError(f"La cantidad máxima de personas por reserva es {maximo}.")
        return valor

    @field_validator("titular")
    @classmethod
    def validar_titular(cls, valor: str) -> str:
        if not valor:
            raise ValueError("El nombre del titular es obligatorio.")
        if len(valor) < 2 or len(valor) > 100:
            raise ValueError("El nombre del titular debe tener entre 2 y 100 caracteres.")
        if not NOMBRE_REGEX.match(valor):
            raise ValueError(
                "El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones."
            )
        return valor

    @field_validator("telefono")
    @classmethod
    def validar_telefono(cls, valor: str) -> str:
        if not valor:
            raise ValueError("El teléfono es obligatorio.")
        if not TELEFONO_REGEX.match(valor):
            raise ValueError("El teléfono solo puede contener números.")
        if not 8 <= len(valor) <= 15:
            raise ValueError("El teléfono debe tener entre 8 y 15 dígitos.")
        return valor

    @model_validator(mode="after")
    def validar_fechas(self):
        if self.fecha_ingreso < hoy_argentina():
            raise ValueError("La fecha de ingreso no puede ser anterior a hoy.")
        if self.fecha_egreso < self.fecha_ingreso:
            raise ValueError("La fecha de egreso no puede ser anterior a la de ingreso.")
        maximo = settings.MAX_NOCHES_POR_RESERVA
        if (self.fecha_egreso - self.fecha_ingreso).days > maximo:
            raise ValueError(f"La estadía no puede superar las {maximo} noches.")
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
