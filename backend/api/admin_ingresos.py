from datetime import date
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from core.tiempo import hoy_negocio
from models.user import RoleEnum
from schemas.ingresos_admin import IngresosPaginados
from services.ingresos_admin_service import MAX_DIAS_RANGO, listar_ingresos

# Todo el router es solo para el administrador: cualquier otro rol recibe 403
router = APIRouter(
    prefix="/api/v1/admin/ingresos",
    tags=["Historial de ingresos"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


def _dias_pedidos(desde: Optional[date], hasta: Optional[date]) -> Tuple[date, date]:
    """Sin fechas, hoy (en Buenos Aires); con una sola, ese día."""
    if desde is not None and hasta is not None:
        return desde, hasta
    dia = desde or hasta or hoy_negocio()
    return dia, dia


@router.get("", response_model=IngresosPaginados)
def historial_de_ingresos(
    desde: Optional[date] = Query(None, description="Primer día, AAAA-MM-DD (incluido). Solo: ese día"),
    hasta: Optional[date] = Query(None, description="Último día, AAAA-MM-DD (incluido). Solo: ese día"),
    skip: int = Query(0, ge=0, description="Cantidad de ingresos a omitir (paginación)"),
    limit: int = Query(20, ge=1, le=100, description="Cantidad de ingresos por página"),
    db: Session = Depends(get_db),
) -> IngresosPaginados:
    """
    Ingresos al camping aceptados por el servidor, del más nuevo al más viejo.

    Los días son de Buenos Aires. Sin fechas se muestra hoy; con una sola, ese día.
    Los ingresos que el guardia registra sin conexión aparecen cuando la PWA se sincroniza,
    y los rechazados por QR clonado no aparecen (quedan en las alertas).
    """
    inicio, fin = _dias_pedidos(desde, hasta)

    if inicio > fin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha 'desde' no puede ser posterior a 'hasta'.",
        )
    if (fin - inicio).days + 1 > MAX_DIAS_RANGO:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango no puede superar los {MAX_DIAS_RANGO} días.",
        )

    total, items = listar_ingresos(db, inicio, fin, skip=skip, limit=limit)
    return IngresosPaginados(desde=inicio, hasta=fin, total=total, items=items)
