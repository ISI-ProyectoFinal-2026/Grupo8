import re
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.descuento import AplicaDescuentoEnum

# Minúsculas, números y guion bajo; empieza con una letra (ej: "socio", "menores_12")
CODIGO_REGEX = re.compile(r"^[a-z][a-z0-9_]{1,29}$")

EDAD_MAXIMA = 120


def validar_coherencia_edades(
    aplica_a: AplicaDescuentoEnum, edad_min: Optional[int], edad_max: Optional[int]
) -> None:
    """Un descuento por socio no lleva edades; uno por edad necesita las dos y bien ordenadas."""
    if aplica_a == AplicaDescuentoEnum.socio:
        if edad_min is not None or edad_max is not None:
            raise ValueError("Un descuento para socios no lleva límites de edad.")
        return
    if edad_min is None or edad_max is None:
        raise ValueError("Un descuento por edad necesita la edad mínima y la máxima.")
    if edad_min > edad_max:
        raise ValueError("La edad mínima no puede ser mayor que la máxima.")


def _validar_porcentaje(valor: Decimal) -> Decimal:
    if not valor.is_finite() or valor < 0 or valor > 100:
        raise ValueError("El porcentaje debe estar entre 0 y 100.")
    if valor.as_tuple().exponent < -2:
        raise ValueError("El porcentaje admite como máximo 2 decimales.")
    return valor


def _validar_edad(valor: Optional[int]) -> Optional[int]:
    if valor is not None and (valor < 0 or valor > EDAD_MAXIMA):
        raise ValueError(f"La edad debe estar entre 0 y {EDAD_MAXIMA}.")
    return valor


def _validar_nombre(valor: str) -> str:
    if not valor:
        raise ValueError("El nombre es obligatorio.")
    if len(valor) < 2 or len(valor) > 100:
        raise ValueError("El nombre debe tener entre 2 y 100 caracteres.")
    return valor


def _rechazar_no_numericos(valor):
    # Evita que Pydantic convierta "10" o True en un porcentaje válido
    if isinstance(valor, (bool, str)):
        raise ValueError("El porcentaje debe ser un número.")
    return valor


class DescuentoCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    codigo: str
    nombre: str
    aplica_a: AplicaDescuentoEnum
    porcentaje: Decimal
    edad_min: Optional[int] = Field(default=None, strict=True)
    edad_max: Optional[int] = Field(default=None, strict=True)
    activo: bool = True

    @field_validator("codigo")
    @classmethod
    def validar_codigo(cls, valor: str) -> str:
        if not CODIGO_REGEX.match(valor):
            raise ValueError(
                "El código debe tener entre 2 y 30 caracteres: minúsculas, números y guion bajo, "
                "empezando con una letra."
            )
        return valor

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: str) -> str:
        return _validar_nombre(valor)

    @field_validator("porcentaje", mode="before")
    @classmethod
    def porcentaje_numerico(cls, valor):
        return _rechazar_no_numericos(valor)

    @field_validator("porcentaje")
    @classmethod
    def validar_porcentaje(cls, valor: Decimal) -> Decimal:
        return _validar_porcentaje(valor)

    @field_validator("edad_min", "edad_max")
    @classmethod
    def validar_edad(cls, valor: Optional[int]) -> Optional[int]:
        return _validar_edad(valor)

    @model_validator(mode="after")
    def validar_edades(self):
        validar_coherencia_edades(self.aplica_a, self.edad_min, self.edad_max)
        return self


class DescuentoUpdate(BaseModel):
    """Campos que el administrador puede cambiar. El código y a quién aplica quedan fijos."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    nombre: Optional[str] = None
    porcentaje: Optional[Decimal] = None
    edad_min: Optional[int] = Field(default=None, strict=True)
    edad_max: Optional[int] = Field(default=None, strict=True)
    activo: Optional[bool] = None

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: Optional[str]) -> Optional[str]:
        return None if valor is None else _validar_nombre(valor)

    @field_validator("porcentaje", mode="before")
    @classmethod
    def porcentaje_numerico(cls, valor):
        return valor if valor is None else _rechazar_no_numericos(valor)

    @field_validator("porcentaje")
    @classmethod
    def validar_porcentaje(cls, valor: Optional[Decimal]) -> Optional[Decimal]:
        return None if valor is None else _validar_porcentaje(valor)

    @field_validator("edad_min", "edad_max")
    @classmethod
    def validar_edad(cls, valor: Optional[int]) -> Optional[int]:
        return _validar_edad(valor)

    @model_validator(mode="after")
    def validar_campos_enviados(self):
        if not self.model_fields_set:
            raise ValueError("Enviá al menos un campo para modificar.")
        # nombre, porcentaje y activo no admiten null si se envían
        for campo in ("nombre", "porcentaje", "activo"):
            if campo in self.model_fields_set and getattr(self, campo) is None:
                raise ValueError(f"El campo {campo} no puede ser nulo.")
        return self


class DescuentoOut(BaseModel):
    id: UUID
    codigo: str
    nombre: str
    aplica_a: AplicaDescuentoEnum
    porcentaje: float
    edad_min: Optional[int] = None
    edad_max: Optional[int] = None
    activo: bool

    model_config = ConfigDict(from_attributes=True)
