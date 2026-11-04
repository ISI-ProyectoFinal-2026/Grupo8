from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.user import RoleEnum
from schemas.ocupacion import OcupacionOut
from services.ocupacion_service import obtener_ocupacion

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/api/v1/ocupacion",
    tags=["Ocupación"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


@router.get("", response_model=OcupacionOut)
def consultar_ocupacion(db: Session = Depends(get_db)) -> OcupacionOut:
    """
    Personas dentro del camping (ingresos aceptados menos egresos), capacidad máxima y buffer offline.

    Los ingresos que el guardia registra sin conexión recién se cuentan cuando la PWA los
    sincroniza, así que el valor puede ir atrasado hasta entonces.
    """
    ocupacion = obtener_ocupacion(db)
    return OcupacionOut(
        ocupacion_actual=ocupacion.ocupacion_actual,
        capacidad_maxima=ocupacion.capacidad_maxima,
        buffer_offline=ocupacion.buffer_offline,
    )