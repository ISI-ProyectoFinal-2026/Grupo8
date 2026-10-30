import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_user, require_role
from models.reserva import EstadoReservaEnum, Reserva
from models.resolucion_alerta import ResolucionAlerta
from models.user import RoleEnum, User
from schemas.alerta_clonacion import AlertaClonacionOut, ResolucionAlertaOut, ResolverAlertaIn

logger = logging.getLogger(__name__)

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/api/v1/admin/alertas",
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
            fecha_ingreso=r.fecha_ingreso,
            fecha_alerta_clonacion=r.fecha_alerta_clonacion,
        )
        for r in reservas
    ]


@router.post("/{reserva_id}/resolver", response_model=ResolucionAlertaOut)
def resolver_alerta_clonacion(
    reserva_id: UUID,
    payload: Optional[ResolverAlertaIn] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResolucionAlertaOut:
    # Se bloquea la reserva: si dos administradores resuelven a la vez, el segundo espera
    # y encuentra que ya no está en alerta
    reserva = db.query(Reserva).filter(Reserva.id == reserva_id).with_for_update().first()
    if reserva is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reserva no encontrada.")
    if not reserva.en_alerta:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La reserva no está en alerta de clonación (puede que otro administrador ya la haya resuelto).",
        )

    # Se toman los datos del administrador antes del commit, que expira los objetos de la sesión
    admin_id = current_user.id
    admin_nombre = current_user.nombre
    fecha_resolucion = datetime.now(timezone.utc)
    fecha_deteccion = reserva.fecha_alerta_clonacion

    estado_restaurado = reserva.resolver_alerta_clonacion()
    db.add(ResolucionAlerta(
        reserva_id=reserva.id,
        resuelto_por_id=admin_id,
        fecha_deteccion=fecha_deteccion,
        fecha_resolucion=fecha_resolucion,
        estado_restaurado=estado_restaurado,
        nota=payload.nota if payload else None,
    ))

    # El estado y la auditoría se guardan juntos: o quedan los dos o ninguno
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("No se pudo resolver la alerta de la reserva %s", reserva_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo resolver el incidente. Intentá de nuevo.",
        )

    return ResolucionAlertaOut(
        reserva_id=reserva_id,
        estado_restaurado=estado_restaurado,
        resuelto_por_id=admin_id,
        resuelto_por_nombre=admin_nombre,
        fecha_resolucion=fecha_resolucion,
    )