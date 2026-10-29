from datetime import date
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from models.reserva import CondicionPersonaEnum
from schemas.auth import PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH
from schemas.reserva import DNI_REGEX, NOMBRE_REGEX

MotivoSocio = Literal["NO_EXISTE", "NO_ES_SOCIO", "CUOTA_VENCIDA"]


class SocioValidacion(BaseModel):
    """Resultado de validar un DNI. Nombre y condición solo se informan si la membresía está vigente."""

    valido: bool
    motivo: Optional[MotivoSocio] = None
    nombre: Optional[str] = None
    condicion: Optional[CondicionPersonaEnum] = None


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
        if not valor:
            raise ValueError("El nombre es obligatorio.")
        if len(valor) < 2 or len(valor) > 100:
            raise ValueError("El nombre debe tener entre 2 y 100 caracteres.")
        if not NOMBRE_REGEX.match(valor):
            raise ValueError(
                "El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones."
            )
        return valor

    @field_validator("dni")
    @classmethod
    def validar_dni(cls, valor: str) -> str:
        if not DNI_REGEX.match(valor):
            raise ValueError("El DNI debe tener 7 u 8 dígitos, sin puntos.")
        return valor

    @field_validator("password")
    @classmethod
    def validar_largo_maximo(cls, valor: str) -> str:
        if len(valor.encode("utf-8")) > PASSWORD_MAX_BYTES:
            raise ValueError("La contraseña es demasiado larga.")
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
