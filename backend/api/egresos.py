import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_user, require_role
from core.tiempo import ahora_utc
from models.egreso_fisico import EgresoFisico
from models.user import RoleEnum, User
from schemas.egreso import EgresoCreate, EgresoOut
from services.ocupacion_service import personas_dentro

logger = logging.getLogger(__name__)

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/api/v1/egresos",
    tags=["Egresos"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)

# Margen para relojes un poco adelantados; más allá de eso, un egreso en el futuro es un error de carga
_TOLERANCIA_FUTURO = timedelta(minutes=5)

# Candado de Postgres para que dos egresos simultáneos no validen contra la misma ocupación
_CANDADO_EGRESOS = 1802


@router.post("", response_model=EgresoOut, status_code=status.HTTP_201_CREATED)
def registrar_egreso(
    payload: EgresoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EgresoOut:
    ahora = ahora_utc()
    fecha_hora = payload.fecha_hora_egreso or ahora
    if fecha_hora > ahora + _TOLERANCIA_FUTURO:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La fecha y hora del egreso no puede estar en el futuro.",
        )

    # El candado dura hasta el commit o el rollback de esta transacción
    db.execute(text("SELECT pg_advisory_xact_lock(:clave)"), {"clave": _CANDADO_EGRESOS})

    dentro = personas_dentro(db)
    if payload.cantidad_personas > dentro:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"No pueden egresar {payload.cantidad_personas} personas: "
                f"según los ingresos sincronizados hay {dentro} dentro."
            ),
        )

    egreso = EgresoFisico(
        cantidad_personas=payload.cantidad_personas,
        fecha_hora_egreso=fecha_hora,
        registrado_por_id=current_user.id,
    )
    db.add(egreso)

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("No se pudo registrar el egreso")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo registrar el egreso. Intentá de nuevo.",
        )
    db.refresh(egreso)

    return EgresoOut(
        id=egreso.id,
        cantidad_personas=egreso.cantidad_personas,
        fecha_hora_egreso=egreso.fecha_hora_egreso,
        registrado_por_id=egreso.registrado_por_id,
        personas_dentro=dentro - egreso.cantidad_personas,
    )