"""Botón de arrepentimiento: cancelación sin cuenta con un enlace por correo (Issue 25.2)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from core.database import get_db
from models.reserva import Reserva
from schemas.arrepentimiento import (
    ArrepentimientoResultado,
    EnlaceArrepentimiento,
    MensajeArrepentimiento,
    SolicitudArrepentimiento,
)
from schemas.reserva import CancelacionCondiciones
from services.arrepentimiento_service import (
    ENLACE_INVALIDO,
    ENLACE_VENCIDO,
    MENSAJE_SOLICITUD,
    MOTIVO_ARREPENTIMIENTO,
    EnlaceInvalidoError,
    EnlaceVencidoError,
    reserva_del_token,
    solicitar_enlaces,
)
from services.cancelacion_service import (
    CancelacionNoPermitidaError,
    cancelar_reserva,
    condiciones_out,
    evaluar_cancelacion,
    resultado_out,
)

router = APIRouter(prefix="/arrepentimiento", tags=["Arrepentimiento"])


def _reserva_del_enlace(db: Session, token: str) -> Reserva:
    try:
        return reserva_del_token(db, token)
    except EnlaceVencidoError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ENLACE_VENCIDO)
    except EnlaceInvalidoError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ENLACE_INVALIDO)


@router.post("/solicitud", response_model=MensajeArrepentimiento, status_code=status.HTTP_202_ACCEPTED)
def solicitar(
    datos: SolicitudArrepentimiento,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Envía al email un enlace por cada reserva pagada y próxima. Responde lo mismo haya o no reservas."""
    solicitar_enlaces(db, datos.email, background_tasks)
    return MensajeArrepentimiento(mensaje=MENSAJE_SOLICITUD)


@router.get("/condiciones", response_model=CancelacionCondiciones)
def consultar_condiciones(token: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """Las mismas condiciones que GET /reservas/{id}/cancelacion, para la reserva del enlace."""
    return condiciones_out(evaluar_cancelacion(db, _reserva_del_enlace(db, token)))


@router.post("/confirmar", response_model=ArrepentimientoResultado)
def confirmar(
    datos: EnlaceArrepentimiento,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Cancela solo la reserva del enlace. Si ya está cancelada (enlace usado dos veces) responde 422
    y no devuelve el dinero de nuevo."""
    reserva = _reserva_del_enlace(db, datos.token)
    try:
        resultado = cancelar_reserva(db, reserva, background_tasks, motivo=MOTIVO_ARREPENTIMIENTO)
    except CancelacionNoPermitidaError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.mensaje)
    return ArrepentimientoResultado(**resultado_out(resultado).model_dump(), codigo_gestion=str(reserva.id))
