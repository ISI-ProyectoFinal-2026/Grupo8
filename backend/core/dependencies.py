from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
import jwt
from jwt.exceptions import InvalidTokenError
from core.database import get_db
from core.config import settings
from models.user import User, RoleEnum

# Busca el token en el header "Authorization: Bearer <token>".
# "tokenUrl" es la ruta donde el frontend envía el usuario y la contraseña para loguearse.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# Igual que oauth2_scheme, pero sin token no devuelve 401: la ruta sigue y atiende a un visitante
oauth2_scheme_opcional = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def _usuario_desde_token(token: str, db: Session) -> User:
    """Valida el JWT y devuelve el usuario guardado en la base. Cualquier falla es un 401."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        # El login firma solo con HS256; los tokens ES256 son de los QR y no sirven para iniciar sesión
        payload = jwt.decode(token, settings.AUTH_SECRET_KEY, algorithms=["HS256"])
    except InvalidTokenError:
        raise credentials_exception

    # El id del usuario viaja en "sub". Si falta o no es un UUID, el token no sirve
    # (sin esta comprobación la consulta a la base fallaría con un error 500)
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise credentials_exception
    try:
        user_id = UUID(sub)
    except ValueError:
        raise credentials_exception

    # El usuario y su rol se leen de la base en cada request: el claim "rol" del token
    # sirve solo para la interfaz y nunca reemplaza esta consulta
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    return user


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    return _usuario_desde_token(token, db)


def get_current_user_optional(
    token: Optional[str] = Depends(oauth2_scheme_opcional),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """
    Para las rutas que funcionan con o sin sesión (como crear una reserva).
    Sin token devuelve None. Con token, se valida igual que en el resto de la API:
    si es inválido o venció responde 401, así el frontend sabe que tiene que volver a iniciar sesión.
    """
    if token is None:
        return None
    return _usuario_desde_token(token, db)


# Restricción por roles (RBAC): acepta uno o varios roles
def require_role(*roles: RoleEnum):
    if not roles:
        raise ValueError("require_role necesita al menos un rol.")

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.rol not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes los permisos necesarios para realizar esta acción"
            )
        return current_user
    return role_checker
