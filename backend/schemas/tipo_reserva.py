from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.tipo_reserva import FormaCobroEnum

# Tope para que un precio enorme no rompa la columna Numeric(10, 2)
PRECIO_MAXIMO = Decimal("99999999.99")


def validar_unidades_segun_forma_cobro(
    forma_cobro: FormaCobroEnum, cantidad_unidades: Optional[int]
) -> None:
    """Los tipos por persona usan el cupo general; solo los tipos por unidad llevan unidades."""
    if forma_cobro == FormaCobroEnum.POR_PERSONA and cantidad_unidades is not None:
        raise ValueError(
            "Un tipo que se cobra por persona no lleva cantidad de unidades: su límite es el cupo del camping."
        )


def _validar_nombre(valor: str) -> str:
    if len(valor) < 2 or len(valor) > 80:
        raise ValueError("El nombre debe tener entre 2 y 80 caracteres.")
    return valor


def _rechazar_no_numericos(valor):
    # Evita que Pydantic convierta "5000" o True en un precio válido
    if isinstance(valor, (bool, str)):
        raise ValueError("El precio debe ser un número.")
    return valor


def _validar_precio(valor: Decimal) -> Decimal:
    if not valor.is_finite() or valor <= 0:
        raise ValueError("El precio debe ser mayor a 0.")
    if valor > PRECIO_MAXIMO:
        raise ValueError("El precio es demasiado alto.")
    if valor.as_tuple().exponent < -2:
        raise ValueError("El precio admite como máximo 2 decimales.")
    return valor


class TipoReservaCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    nombre: str
    precio: Decimal
    forma_cobro: FormaCobroEnum
    # strict: rechaza "6", 6.5 y True
    max_personas: int = Field(strict=True, gt=0)
    # Vacío = sin límite de unidades
    cantidad_unidades: Optional[int] = Field(default=None, strict=True, ge=1)
    activo: bool = True

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: str) -> str:
        return _validar_nombre(valor)

    @field_validator("precio", mode="before")
    @classmethod
    def precio_numerico(cls, valor):
        return _rechazar_no_numericos(valor)

    @field_validator("precio")
    @classmethod
    def validar_precio(cls, valor: Decimal) -> Decimal:
        return _validar_precio(valor)

    @model_validator(mode="after")
    def validar_unidades(self):
        validar_unidades_segun_forma_cobro(self.forma_cobro, self.cantidad_unidades)
        return self


class TipoReservaUpdate(BaseModel):
    """Cambios parciales: solo se modifican los campos enviados. Desactivar es {"activo": false}."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    nombre: Optional[str] = None
    precio: Optional[Decimal] = None
    forma_cobro: Optional[FormaCobroEnum] = None
    max_personas: Optional[int] = Field(default=None, strict=True, gt=0)
    # Enviar null deja el tipo sin límite de unidades
    cantidad_unidades: Optional[int] = Field(default=None, strict=True, ge=1)
    activo: Optional[bool] = None

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: Optional[str]) -> Optional[str]:
        return None if valor is None else _validar_nombre(valor)

    @field_validator("precio", mode="before")
    @classmethod
    def precio_numerico(cls, valor):
        return valor if valor is None else _rechazar_no_numericos(valor)

    @field_validator("precio")
    @classmethod
    def validar_precio(cls, valor: Optional[Decimal]) -> Optional[Decimal]:
        return None if valor is None else _validar_precio(valor)

    @model_validator(mode="after")
    def validar_campos_enviados(self):
        if not self.model_fields_set:
            raise ValueError("Enviá al menos un campo para modificar.")
        # Solo cantidad_unidades admite null (significa sin límite)
        for campo in ("nombre", "precio", "forma_cobro", "max_personas", "activo"):
            if campo in self.model_fields_set and getattr(self, campo) is None:
                raise ValueError(f"El campo {campo} no puede ser nulo.")
        return self


class TipoReservaPublico(BaseModel):
    """Lo que ve la web de reservas: solo tipos activos, sin el campo activo."""

    id: UUID
    nombre: str
    precio: float
    forma_cobro: FormaCobroEnum
    max_personas: int
    cantidad_unidades: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class TipoReservaOut(TipoReservaPublico):
    activo: bool
