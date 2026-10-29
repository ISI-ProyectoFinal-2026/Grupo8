from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import settings
from models.user import RoleEnum, User
from schemas.auth import PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, UsuarioSesion
from services.socio_service import membresia_vigente

# El login usa solo HS256 con AUTH_SECRET_KEY; ES256 queda para los QR
ALGORITMO_JWT = "HS256"

# Se compara contra este hash cuando el usuario no existe, para que la respuesta
# tarde lo mismo y no deje adivinar qué DNI o email están registrados
_HASH_FICTICIO = bcrypt.hashpw(b"usuario-inexistente", bcrypt.gensalt()).decode("utf-8")


def hash_password(password: str) -> str:
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"La contraseña debe tener al menos {PASSWORD_MIN_LENGTH} caracteres.")
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > PASSWORD_MAX_BYTES:
        raise ValueError("La contraseña es demasiado larga.")
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


def verificar_password(password: str, password_hash: Optional[str]) -> bool:
    """Nunca lanza excepción: un hash malformado (ej: "!") cuenta como contraseña incorrecta."""
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def buscar_por_identificador(db: Session, identificador: str) -> Optional[User]:
    identificador = identificador.strip()
    if not identificador:
        return None
    if "@" in identificador:
        return db.query(User).filter(func.lower(User.email) == identificador.lower()).first()
    return db.query(User).filter(User.dni == identificador).first()


def autenticar(db: Session, identificador: str, password: str) -> Optional[User]:
    """Devuelve el usuario si las credenciales son correctas; si no, None (sin decir por qué)."""
    usuario = buscar_por_identificador(db, identificador)
    if usuario is None:
        verificar_password(password, _HASH_FICTICIO)
        return None
    if not verificar_password(password, usuario.password_hash):
        return None
    return usuario


def duracion_token(rol: RoleEnum) -> timedelta:
    # El guardia puede pasar días sin conexión, por eso su sesión dura más
    if rol == RoleEnum.SEGURIDAD:
        return timedelta(hours=settings.GUARD_TOKEN_EXPIRE_HOURS)
    return timedelta(minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES)


def crear_token(usuario: User) -> tuple[str, int]:
    """Devuelve el JWT y su duración en segundos."""
    ahora = datetime.now(timezone.utc)
    duracion = duracion_token(usuario.rol)
    payload = {
        "sub": str(usuario.id),
        "rol": usuario.rol.name,
        "iat": ahora,
        "exp": ahora + duracion,
    }
    token = jwt.encode(payload, settings.AUTH_SECRET_KEY, algorithm=ALGORITMO_JWT)
    return token, int(duracion.total_seconds())


def usuario_sesion(usuario: User) -> UsuarioSesion:
    return UsuarioSesion(
        id=usuario.id,
        nombre=usuario.nombre,
        email=usuario.email,
        dni=usuario.dni,
        rol=usuario.rol.name,
        is_socio=bool(usuario.is_socio),
        membresia_vigente=membresia_vigente(usuario),
        membresia_vence=usuario.membresia_vence,
    )
