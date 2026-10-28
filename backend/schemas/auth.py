from datetime import date
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel

# Regla compartida para cualquier contraseña que se guarde (login, alta de socios, seeds)
PASSWORD_MIN_LENGTH = 8

RolSesion = Literal["ADMIN", "SEGURIDAD", "CLIENTE"]


class LoginRequest(BaseModel):
    # Si contiene "@" se toma como email; si no, como DNI
    identificador: str
    password: str


class UsuarioSesion(BaseModel):
    """Datos del usuario que recibe el frontend al iniciar sesión y en GET /auth/me."""

    id: UUID
    nombre: str
    email: str
    dni: str
    rol: RolSesion
    is_socio: bool
    membresia_vigente: bool
    membresia_vence: Optional[date] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int  # segundos
    usuario: UsuarioSesion
