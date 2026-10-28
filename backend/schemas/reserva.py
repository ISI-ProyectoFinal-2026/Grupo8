import re
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from core.config import settings
from models.reserva import CondicionPersonaEnum, EstadoPagoEnum, EstadoReservaEnum

ZONA_HORARIA = ZoneInfo("America/Argentina/Buenos_Aires")

FECHA_ISO_REGEX = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Letras (con acentos), separadas por espacios, puntos, apóstrofes o guiones
NOMBRE_REGEX = re.compile(r"^[^\W\d_]+(?:[ .'’\-]+[^\W\d_]+)*\.?$")
DNI_REGEX = re.compile(r"^\d{7,8}$")

EDAD_MAXIMA = 120


def hoy_argentina() -> date:
    """'Hoy' según la hora del camping, no la del servidor."""
    return datetime.now(ZONA_HORARIA).date()


class PersonaReserva(BaseModel):
    """Una persona de la reserva. Las reglas son las mismas que valida el formulario."""

    model_config = ConfigDict(str_strip_whitespace=True)

    nombre: str
    # strict: rechaza "34", 2.5 y True; solo enteros reales
    edad: int = Field(strict=True)
    condicion: CondicionPersonaEnum
    dni: Optional[str] = None

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: str) -> str:
        if not valor:
            raise ValueError("El nombre es obligatorio.")
        if len(valor) < 2 or len(valor) > 100:
            raise ValueError("El nombre debe tener entre 2 y 100 caracteres.")
        if not NOMBRE_REGEX.match(valor):
            raise ValueError(
                "El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones."
            )
        return valor

    @field_validator("edad")
    @classmethod
    def validar_edad(cls, valor: int) -> int:
        if valor < 0 or valor > EDAD_MAXIMA:
            raise ValueError(f"La edad debe estar entre 0 y {EDAD_MAXIMA}.")
        return valor

    @field_validator("dni", mode="before")
    @classmethod
    def vaciar_dni_en_blanco(cls, valor):
        # Un DNI vacío se trata como si no se hubiera enviado
        if isinstance(valor, str) and not valor.strip():
            return None
        return valor

    @field_validator("dni")
    @classmethod
    def validar_formato_dni(cls, valor: Optional[str]) -> Optional[str]:
        if valor is not None and not DNI_REGEX.match(valor):
            raise ValueError("El DNI debe tener 7 u 8 dígitos, sin puntos.")
        return valor

    @model_validator(mode="after")
    def validar_dni_de_socio(self):
        if self.condicion == CondicionPersonaEnum.socio and self.dni is None:
            raise ValueError("El DNI es obligatorio para socios.")
        return self


class ReservaCreate(BaseModel):
    # Se recortan espacios al inicio/fin de todos los textos antes de validar
    model_config = ConfigDict(str_strip_whitespace=True)

    user_id: UUID
    fecha_ingreso: date
    fecha_egreso: date
    # La primera persona es el titular; la cantidad de personas sale del largo de la lista
    personas: List[PersonaReserva]
    # EmailStr usa email-validator (sin chequeo DNS por defecto)
    email: EmailStr

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

    @field_validator("personas")
    @classmethod
    def validar_personas(cls, valor: List[PersonaReserva]) -> List[PersonaReserva]:
        maximo = settings.MAX_PERSONAS_POR_RESERVA
        if len(valor) < 1:
            raise ValueError("Debe haber al menos 1 persona en la reserva.")
        if len(valor) > maximo:
            raise ValueError(f"La cantidad máxima de personas por reserva es {maximo}.")
        dnis = [p.dni for p in valor if p.dni is not None]
        if len(dnis) != len(set(dnis)):
            raise ValueError("Hay un DNI repetido dentro de la reserva.")
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

class PersonaOut(BaseModel):
    nombre: str
    edad: int
    condicion: CondicionPersonaEnum
    dni: Optional[str] = None
    precio_base: float
    descuento_pct: float
    precio_final: float

    model_config = ConfigDict(from_attributes=True)


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
    # Solo lo tienen las reservas anteriores; las nuevas ya no piden teléfono
    telefono: Optional[str] = None
    estado_reserva: EstadoReservaEnum
    estado_pago: EstadoPagoEnum
    jwt_jti: Optional[str] = None
    personas: List[PersonaOut] = []

    model_config = ConfigDict(from_attributes=True)
