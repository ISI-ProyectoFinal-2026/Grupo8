from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.user import RoleEnum
from schemas.ocupacion import EsperadosOut
from services.ocupacion_service import obtener_esperados

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/api/v1/admin/esperados",
    tags=["Ocupación"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


@router.get("", response_model=EsperadosOut)
def consultar_esperados(db: Session = Depends(get_db)) -> EsperadosOut:
    """
    Reservas pagadas cuya estadía incluye hoy (día de Buenos Aires) y que todavía no
    registraron ningún ingreso, con el total de personas. No forman parte de la ocupación actual.
    """
    esperados = obtener_esperados(db)
    return EsperadosOut(reservas=esperados.reservas, personas=esperados.personas)
