from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_user
from models.user import User
from schemas.auth import LoginRequest, LoginResponse, UsuarioSesion
from services.auth_service import autenticar, crear_token, usuario_sesion

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/login", response_model=LoginResponse)
def login(datos: LoginRequest, db: Session = Depends(get_db)):
    """Inicia sesión con DNI o email y contraseña. No hay registro público."""
    usuario = autenticar(db, datos.identificador, datos.password)
    if usuario is None:
        # Mismo mensaje si el usuario no existe o si la contraseña es incorrecta
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token, expires_in = crear_token(usuario)
    return LoginResponse(
        access_token=token,
        expires_in=expires_in,
        usuario=usuario_sesion(usuario),
    )


@router.get("/me", response_model=UsuarioSesion)
def obtener_usuario_actual(current_user: User = Depends(get_current_user)):
    """Devuelve los datos de la sesión actual, incluido el estado de la membresía."""
    return usuario_sesion(current_user)
