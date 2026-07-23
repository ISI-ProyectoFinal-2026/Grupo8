from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
import jwt
from jwt.exceptions import InvalidTokenError
from core.database import get_db
from core.config import settings
from models.user import User, RoleEnum  # Ajustá la ruta según tu proyecto

# Criterio de Aceptación 1: OAuth2PasswordBearer
# Esto le dice a FastAPI que busque el token en el header "Authorization: Bearer <token>"
# "tokenUrl" es la ruta donde el frontend enviará usuario/contraseña para loguearse.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

# Criterio de Aceptación 2: Obtención del usuario autenticado
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        # Decodificamos el JWT usando la clave de tu .env (ajustá "ES256" si tu SecurityService genera otro algoritmo)
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=["ES256", "HS256"])
        
        # Asumimos que el ID del usuario viaja en el campo "sub" (subject) del JWT
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
            
    except InvalidTokenError:
        raise credentials_exception
        
    # Buscamos al usuario en la base de datos
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
        
    return user

# Criterio de Aceptación 3: Restricción por roles - RBAC
def require_role(required_role: RoleEnum):
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.rol != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes los permisos necesarios para realizar esta acción"
            )
        return current_user
    return role_checker