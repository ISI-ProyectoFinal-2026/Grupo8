from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from core.tiempo import a_zona_negocio, ahora_utc
from models.user import RoleEnum
from schemas.cobros import ResumenCobros
from services.cobros_service import MAX_DIAS_RANGO, resumen_cobros

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/api/v1/admin/cobros",
    tags=["Cobros"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)

# Sin fechas se muestra la última semana, contando hoy
DIAS_POR_DEFECTO = 7


@router.get("", response_model=ResumenCobros)
def consultar_cobros(
    desde: Optional[date] = Query(None, description="Primer día, AAAA-MM-DD (incluido)"),
    hasta: Optional[date] = Query(None, description="Último día, AAAA-MM-DD (incluido). Por defecto, hoy"),
    db: Session = Depends(get_db),
) -> ResumenCobros:
    """
    Lo cobrado por día en efectivo (ingresos manuales) y con Mercado Pago (solo pagos aprobados).

    Los días son de Buenos Aires. Los ingresos en efectivo que el guardia registra sin
    conexión recién aparecen cuando la PWA los sincroniza.
    """
    if hasta is None:
        hasta = a_zona_negocio(ahora_utc()).date()
    if desde is None:
        desde = hasta - timedelta(days=DIAS_POR_DEFECTO - 1)

    if desde > hasta:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha 'desde' no puede ser posterior a 'hasta'.",
        )
    if (hasta - desde).days + 1 > MAX_DIAS_RANGO:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El rango no puede superar los {MAX_DIAS_RANGO} días.",
        )

    return ResumenCobros(**resumen_cobros(db, desde, hasta))
