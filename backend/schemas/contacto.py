"""Formulario de Contacto de la web de reservas (Issue 31.5)."""
import re

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator

from schemas.reserva import validar_nombre_persona

MENSAJE_MIN = 10
MENSAJE_MAX = 2000

# Caracteres de control salvo el salto de línea y la tabulación, que sí son normales en un mensaje
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ContactoSolicitud(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    nombre: str
    # EmailStr ya rechaza direcciones con saltos de línea o de más de 254 caracteres
    email: EmailStr
    mensaje: str

    @field_validator("nombre")
    @classmethod
    def validar_nombre(cls, valor: str) -> str:
        # Mismas reglas que el nombre de una reserva: solo letras, espacios, puntos, apóstrofes y guiones.
        # Sin saltos de línea, así el nombre no puede romper el asunto del correo
        return validar_nombre_persona(valor)

    @field_validator("mensaje")
    @classmethod
    def validar_mensaje(cls, valor: str) -> str:
        if not valor:
            raise ValueError("El mensaje es obligatorio.")
        if len(valor) < MENSAJE_MIN:
            raise ValueError(f"El mensaje debe tener al menos {MENSAJE_MIN} caracteres.")
        if len(valor) > MENSAJE_MAX:
            raise ValueError(f"El mensaje no puede superar los {MENSAJE_MAX} caracteres.")
        if _CONTROL.search(valor):
            raise ValueError("El mensaje tiene caracteres no permitidos.")
        return valor


class ContactoRespuesta(BaseModel):
    mensaje: str
