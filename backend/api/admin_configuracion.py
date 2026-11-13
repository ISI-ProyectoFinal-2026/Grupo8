from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.configuracion import ConfiguracionCamping
from models.user import RoleEnum
from schemas.configuracion import ConfiguracionOut, ConfiguracionUpdate
from services.camping_service import (
    PORCENTAJE_BUFFER_RECOMENDADO,
    actualizar_configuracion,
    obtener_o_crear_camping,
)

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/api/v1/admin/configuracion",
    tags=["Configuración"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


def _respuesta(camping: ConfiguracionCamping) -> ConfiguracionOut:
    return ConfiguracionOut(
        capacidad_total=camping.capacidad_total,
        porcentaje_buffer_offline=camping.porcentaje_buffer_offline,
        max_personas_por_reserva=camping.max_personas_por_reserva,
        dias_cancelacion=camping.dias_cancelacion,
        porcentaje_devolucion=camping.porcentaje_devolucion,
        porcentaje_buffer_recomendado=PORCENTAJE_BUFFER_RECOMENDADO,
    )


@router.get("", response_model=ConfiguracionOut)
def consultar_configuracion(db: Session = Depends(get_db)) -> ConfiguracionOut:
    """Cupo del camping, buffer offline, máximo de personas por reserva y reglas de cancelación."""
    return _respuesta(obtener_o_crear_camping(db))


@router.put("", response_model=ConfiguracionOut)
def editar_configuracion(cambios: ConfiguracionUpdate, db: Session = Depends(get_db)) -> ConfiguracionOut:
    """
    Guarda todos los valores juntos. Las reservas ya hechas no se tocan: si el cupo baja
    por debajo de lo reservado, simplemente se deja de vender hasta que se libere lugar.
    """
    camping = actualizar_configuracion(
        db,
        capacidad_total=cambios.capacidad_total,
        porcentaje_buffer_offline=cambios.porcentaje_buffer_offline,
        max_personas_por_reserva=cambios.max_personas_por_reserva,
        dias_cancelacion=cambios.dias_cancelacion,
        porcentaje_devolucion=cambios.porcentaje_devolucion,
    )
    return _respuesta(camping)
