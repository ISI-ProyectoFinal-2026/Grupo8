from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from schemas.usuario import UsuarioPruebaResponse
from services.usuario_prueba_service import obtener_o_crear_usuario_prueba

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])


@router.get(
    "/prueba",
    response_model=UsuarioPruebaResponse,
    summary="Usuario de prueba para desarrollo",
)
def obtener_usuario_prueba(db: Session = Depends(get_db)):
    """
    Devuelve el id de un usuario que EXISTE en la base de datos actual
    (lo crea si hace falta). Reemplaza el UUID hardcodeado que tenía el frontend.

    Es un puente temporal hasta que el login real esté implementado: cuando
    exista, el `user_id` debería salir del token del usuario autenticado.
    Está deshabilitado cuando ENVIRONMENT=production.
    """
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Endpoint no disponible en producción.",
        )

    usuario = obtener_o_crear_usuario_prueba(db)
    return UsuarioPruebaResponse(
        user_id=usuario.id,
        email=usuario.email,
        nombre=usuario.nombre,
    )
