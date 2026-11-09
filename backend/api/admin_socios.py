from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.user import RoleEnum
from schemas.socio import EstadoMembresia, SocioCreate, SocioOut, SocioRenovacion, SocioUpdate
from services.alta_socio_service import (
    EstadoSocioError,
    SocioDuplicadoError,
    SocioNoEncontradoError,
    crear_socio,
    dar_de_baja,
    editar_socio,
    listar_socios,
    reactivar_socio,
    renovar_membresia,
    socio_out,
)

# Nombre del campo tal como se le muestra al administrador
NOMBRE_CAMPO = {"dni": "DNI", "email": "email"}

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/admin/socios",
    tags=["Socios"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


def _duplicado(error: SocioDuplicadoError) -> HTTPException:
    return HTTPException(status_code=409, detail=f"Ya existe un usuario con ese {NOMBRE_CAMPO[error.campo]}.")


def _no_encontrado() -> HTTPException:
    return HTTPException(status_code=404, detail="Socio no encontrado.")


@router.get("", response_model=List[SocioOut])
def listar(
    buscar: Optional[str] = Query(
        None, max_length=100, description="DNI (o su comienzo) o palabras del nombre"
    ),
    estado: Optional[EstadoMembresia] = Query(None, description="vigente, vencida o baja"),
    db: Session = Depends(get_db),
):
    """Padrón de socios. Sin parámetros devuelve todos, incluidos los dados de baja."""
    return [socio_out(socio) for socio in listar_socios(db, buscar, estado)]


@router.post("", response_model=SocioOut, status_code=status.HTTP_201_CREATED)
def alta_socio(socio_in: SocioCreate, db: Session = Depends(get_db)):
    try:
        socio = crear_socio(db, socio_in)
    except SocioDuplicadoError as error:
        raise _duplicado(error)
    return socio_out(socio)


@router.put("/{socio_id}", response_model=SocioOut)
def editar(socio_id: UUID, cambios: SocioUpdate, db: Session = Depends(get_db)):
    """Corrige nombre, DNI o email. Los campos que no se envían quedan como están."""
    try:
        socio = editar_socio(db, socio_id, cambios)
    except SocioNoEncontradoError:
        raise _no_encontrado()
    except SocioDuplicadoError as error:
        raise _duplicado(error)
    return socio_out(socio)


@router.post("/{socio_id}/renovar", response_model=SocioOut)
def renovar(socio_id: UUID, renovacion: SocioRenovacion, db: Session = Depends(get_db)):
    """Nueva fecha de vencimiento de la membresía (hoy o posterior)."""
    try:
        socio = renovar_membresia(db, socio_id, renovacion)
    except SocioNoEncontradoError:
        raise _no_encontrado()
    except EstadoSocioError as error:
        raise HTTPException(status_code=409, detail=str(error))
    return socio_out(socio)


@router.post("/{socio_id}/baja", response_model=SocioOut)
def baja(socio_id: UUID, db: Session = Depends(get_db)):
    """Da de baja al socio sin borrarlo: deja de validar como socio y no puede iniciar sesión."""
    try:
        socio = dar_de_baja(db, socio_id)
    except SocioNoEncontradoError:
        raise _no_encontrado()
    except EstadoSocioError as error:
        raise HTTPException(status_code=409, detail=str(error))
    return socio_out(socio)


@router.post("/{socio_id}/reactivar", response_model=SocioOut)
def reactivar(socio_id: UUID, db: Session = Depends(get_db)):
    """Vuelve a activar a un socio dado de baja. La fecha de vencimiento no cambia."""
    try:
        socio = reactivar_socio(db, socio_id)
    except SocioNoEncontradoError:
        raise _no_encontrado()
    except EstadoSocioError as error:
        raise HTTPException(status_code=409, detail=str(error))
    return socio_out(socio)
