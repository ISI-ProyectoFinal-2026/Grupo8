from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from schemas.disponibilidad import (
    DiaDisponibilidad,
    DisponibilidadResponse,
    EstadiaDisponibilidad,
)
from schemas.reserva import hoy_argentina
from services.camping_service import cupo_online, obtener_o_crear_camping
from services.capacity_service import CapacityService

# Público y de solo lectura: la web de reservas muestra cuántos lugares quedan sin iniciar sesión
router = APIRouter(prefix="/disponibilidad", tags=["Disponibilidad"])

MAX_DIAS = 31

capacity_service = CapacityService()


def _lugares(cupo: int, ocupados: int) -> dict:
    disponibles = max(cupo - ocupados, 0)
    return {"ocupados": ocupados, "disponibles": disponibles, "completo": disponibles == 0}


@router.get("", response_model=DisponibilidadResponse)
def consultar_disponibilidad(
    desde: date = Query(..., description="Primer día a consultar (AAAA-MM-DD)"),
    dias: int = Query(7, ge=1, le=MAX_DIAS, description="Cuántos días consultar, contando el primero"),
    egreso: Optional[date] = Query(None, description="Si se manda, también se calcula la estadía desde `desde` hasta este día"),
    db: Session = Depends(get_db),
) -> DisponibilidadResponse:
    """
    Lugares ocupados y libres de cada día, con la misma regla de cupo que usa la reserva
    (CapacityService): cuentan personas, y no cuentan las canceladas ni las pendientes vencidas.
    """
    if desde < hoy_argentina():
        raise HTTPException(status_code=422, detail="La fecha no puede ser anterior a hoy.")
    if egreso is not None:
        if egreso < desde:
            raise HTTPException(status_code=422, detail="El egreso no puede ser anterior al ingreso.")
        if (egreso - desde).days > settings.MAX_NOCHES_POR_RESERVA:
            raise HTTPException(
                status_code=422,
                detail=f"La estadía no puede superar las {settings.MAX_NOCHES_POR_RESERVA} noches.",
            )

    camping = obtener_o_crear_camping(db)
    cupo = cupo_online(camping.capacidad_total, camping.porcentaje_buffer_offline)

    ocupados_por_dia = capacity_service.lugares_ocupados_por_dia(
        db, desde, desde + timedelta(days=dias - 1)
    )
    estadia = None
    if egreso is not None:
        # La reserva suma todo lo que se solapa con el rango entero, no el máximo de un día
        estadia = EstadiaDisponibilidad(
            ingreso=desde,
            egreso=egreso,
            **_lugares(cupo, capacity_service.lugares_ocupados(db, desde, egreso)),
        )

    return DisponibilidadResponse(
        cupo_maximo=cupo,
        dias=[DiaDisponibilidad(fecha=dia, **_lugares(cupo, ocupados)) for dia, ocupados in ocupados_por_dia.items()],
        estadia=estadia,
    )
