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
    (lo crea si hace falta). Sirve para probar a mano los endpoints que piden
    sesión (por ejemplo, armar un token con ese id y llamar a GET /reservas/mias).

    El frontend ya no lo usa: reservar no necesita ningún user_id, porque la
    reserva se asocia al usuario del token o queda sin cuenta si no hay sesión.
    Solo para desarrollo: está deshabilitado cuando ENVIRONMENT=production.
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
