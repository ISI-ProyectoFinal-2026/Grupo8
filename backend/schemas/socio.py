from datetime import date
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from models.reserva import CondicionPersonaEnum
from schemas.auth import PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH
from schemas.reserva import DNI_REGEX, NOMBRE_REGEX, hoy_argentina

MotivoSocio = Literal["NO_EXISTE", "NO_ES_SOCIO", "CUOTA_VENCIDA"]

# Filtro del padrón: membresía al día, vencida (sigue activo) o dado de baja
EstadoMembresia = Literal["vigente", "vencida", "baja"]


class SocioValidacion(BaseModel):
    """Resultado de validar un DNI. Nombre y condición solo se informan si la membresía está vigente."""

    valido: bool
    motivo: Optional[MotivoSocio] = None
    nombre: Optional[str] = None
    condicion: Optional[CondicionPersonaEnum] = None


def _validar_nombre(valor: str) -> str:
    if not valor:
        raise ValueError("El nombre es obligatorio.")
    if len(valor) < 2 or len(valor) > 100:
        raise ValueError("El nombre debe tener entre 2 y 100 caracteres.")
    if not NOMBRE_REGEX.match(valor):
        raise ValueError(
            "El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones."
        )
    return valor


def _validar_dni(valor: str) -> str:
    if not DNI_REGEX.match(valor):
        raise ValueError("El DNI debe tener 7 u 8 dígitos, sin puntos.")
    return valor


class SocioCreate(BaseModel):
    """Alta de un socio por el administrador. Las reglas son las mismas que valida el formulario."""

    nombre: str
    dni: str
    email: EmailStr
    # Contraseña inicial: la define el administrador. No se recortan sus espacios,
    # porque el socio tiene que poder iniciar sesión con exactamente lo que se cargó
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    membresia_vence: date

    @field_validator("nombre", "dni", "email", mode="before")
    @classmethod
    def recortar_espacios(cls, valor):
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: str) -> str:
        return _validar_nombre(valor)

    @field_validator("dni")
    @classmethod
    def validar_dni(cls, valor: str) -> str:
        return _validar_dni(valor)

    @field_validator("password")
    @classmethod
    def validar_largo_maximo(cls, valor: str) -> str:
        if len(valor.encode("utf-8")) > PASSWORD_MAX_BYTES:
            raise ValueError("La contraseña es demasiado larga.")
        return valor


class SocioUpdate(BaseModel):
    """
    Corrección de datos de un socio. Solo se aplican los campos enviados.
    La fecha de vencimiento se cambia con la renovación; cualquier otro campo se rechaza.
    """

    model_config = ConfigDict(extra="forbid")

    nombre: Optional[str] = None
    dni: Optional[str] = None
    email: Optional[EmailStr] = None

    @field_validator("nombre", "dni", "email", mode="before")
    @classmethod
    def recortar_espacios(cls, valor):
        return valor.strip() if isinstance(valor, str) else valor

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: Optional[str]) -> Optional[str]:
        return None if valor is None else _validar_nombre(valor)

    @field_validator("dni")
    @classmethod
    def validar_dni(cls, valor: Optional[str]) -> Optional[str]:
        return None if valor is None else _validar_dni(valor)

    @model_validator(mode="after")
    def sin_valores_vacios(self):
        # Los campos son opcionales para poder mandar solo los que cambian,
        # pero ninguno se puede borrar
        for campo in self.model_fields_set:
            if getattr(self, campo) is None:
                raise ValueError(f"El campo {campo} no puede quedar vacío.")
        return self


class SocioRenovacion(BaseModel):
    """Nueva fecha de vencimiento de la membresía."""

    model_config = ConfigDict(extra="forbid")

    membresia_vence: date

    @field_validator("membresia_vence")
    @classmethod
    def no_en_el_pasado(cls, valor: date) -> date:
        # Hoy se acepta: la membresía vale hasta el último minuto de ese día
        if valor < hoy_argentina():
            raise ValueError("La nueva fecha de vencimiento no puede ser anterior a hoy.")
        return valor


class SocioOut(BaseModel):
    """Datos de un socio para el panel. Nunca incluye la contraseña."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nombre: str
    dni: str
    email: str
    membresia_vence: Optional[date] = None
    membresia_vigente: bool
    activo: bool
