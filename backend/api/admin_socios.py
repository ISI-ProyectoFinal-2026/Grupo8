from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.user import RoleEnum
from schemas.socio import SocioCreate, SocioOut
from services.alta_socio_service import SocioDuplicadoError, crear_socio, listar_socios, socio_out

# Nombre del campo tal como se le muestra al administrador
NOMBRE_CAMPO = {"dni": "DNI", "email": "email"}

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/admin/socios",
    tags=["Socios"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


@router.get("", response_model=List[SocioOut])
def listar(db: Session = Depends(get_db)):
    return [socio_out(socio) for socio in listar_socios(db)]


@router.post("", response_model=SocioOut, status_code=status.HTTP_201_CREATED)
def alta_socio(socio_in: SocioCreate, db: Session = Depends(get_db)):
    try:
        socio = crear_socio(db, socio_in)
    except SocioDuplicadoError as error:
        raise HTTPException(status_code=409, detail=f"Ya existe un usuario con ese {NOMBRE_CAMPO[error.campo]}.")
    return socio_out(socio)
