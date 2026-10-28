from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.reserva import EstadoReservaEnum, Reserva
from models.user import RoleEnum
from schemas.alerta_clonacion import AlertaClonacionOut

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/admin/alertas-clonacion",
    tags=["Alertas de clonación"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


@router.get("", response_model=List[AlertaClonacionOut])
def listar_alertas_clonacion(db: Session = Depends(get_db)) -> List[AlertaClonacionOut]:
    reservas = (
        db.query(Reserva)
        .filter(Reserva.estado_reserva == EstadoReservaEnum.ALERTA_CLONACION)
        .order_by(Reserva.fecha_alerta_clonacion.desc().nulls_last())
        .all()
    )
    return [
        AlertaClonacionOut(
            reserva_id=r.id,
            titular=r.titular,
            fecha_alerta_clonacion=r.fecha_alerta_clonacion,
        )
        for r in reservas
    ]