from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from core.config import settings
from models.tipo_reserva import TipoReserva


class TipoReservaError(ValueError):
    """Error de negocio de una reserva según su tipo. El endpoint lo devuelve con status_code."""

    def __init__(self, mensaje: str, status_code: int = 422):
        super().__init__(mensaje)
        self.status_code = status_code


def obtener_tipo_activo(db: Session, tipo_id: UUID, bloquear: bool = False) -> TipoReserva:
    """
    El tipo elegido, solo si existe y está activo. Con bloquear=True la fila queda trabada hasta
    el commit: así dos pedidos por la última unidad no se venden a la vez.
    """
    consulta = db.query(TipoReserva).filter(TipoReserva.id == tipo_id, TipoReserva.activo.is_(True))
    if bloquear:
        consulta = consulta.populate_existing().with_for_update()
    tipo = consulta.first()
    if tipo is None:
        raise TipoReservaError("El tipo de reserva no existe o no está disponible.")
    return tipo


def verificar_maximo_del_tipo(tipo: TipoReserva, cantidad: int) -> None:
    """El máximo general por reserva se controla aparte (Issue 19.1); este es el del tipo."""
    if cantidad > tipo.max_personas:
        raise TipoReservaError(
            f"Una reserva de {tipo.nombre} admite como máximo {tipo.max_personas} personas."
        )


def calcular_noches(fecha_ingreso: date, fecha_egreso: date) -> int:
    """Noches de una reserva por unidad: egreso − ingreso. Se exige al menos una."""
    noches = (fecha_egreso - fecha_ingreso).days
    if noches < 1:
        raise TipoReservaError("Una reserva por unidad necesita al menos una noche.")
    if noches > settings.MAX_NOCHES_POR_RESERVA:
        raise TipoReservaError(f"La estadía no puede superar las {settings.MAX_NOCHES_POR_RESERVA} noches.")
    return noches


def verificar_unidades_libres(tipo: TipoReserva, ocupadas: int) -> None:
    """Sin cantidad de unidades, el tipo no tiene límite."""
    if tipo.cantidad_unidades is not None and ocupadas >= tipo.cantidad_unidades:
        raise TipoReservaError(
            f"No quedan unidades de {tipo.nombre} disponibles para alguna de las noches elegidas.",
            status_code=409,
        )

