"""Botón de arrepentimiento sin cuenta (Issue 25.2). Contratos acordados en contratos_sprint6.md."""
from pydantic import BaseModel, EmailStr, Field

from schemas.reserva import CancelacionResultado


class SolicitudArrepentimiento(BaseModel):
    email: EmailStr


class EnlaceArrepentimiento(BaseModel):
    token: str = Field(min_length=1)


class MensajeArrepentimiento(BaseModel):
    mensaje: str


class ArrepentimientoResultado(CancelacionResultado):
    """Respuesta de POST /arrepentimiento/confirmar: la de POST /reservas/{id}/cancelar más el código de gestión."""

    codigo_gestion: str
