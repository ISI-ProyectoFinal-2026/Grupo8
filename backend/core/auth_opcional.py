from typing import Optional

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_user
from models.user import User

# Igual que oauth2_scheme, pero sin token no devuelve 401: la ruta sigue y atiende a un visitante
oauth2_scheme_opcional = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


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
    return get_current_user(token, db)
