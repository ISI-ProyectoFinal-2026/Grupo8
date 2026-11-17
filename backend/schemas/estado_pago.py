from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

# confirmada: reserva pagada. en_proceso: el pago todavía no se aprobó o falta confirmarlo.
# rechazado: el pago no se aprobó. cancelada: la reserva se canceló (por ejemplo, el pago llegó
# fuera de plazo y sin cupo, y se devolvió). revision: el importe cobrado no coincide.
EstadoRetorno = Literal["confirmada", "en_proceso", "rechazado", "cancelada", "revision"]


class ReservaRetorno(BaseModel):
    """Lo que muestra la pantalla de pago exitoso. Sin datos personales del titular."""

    id: UUID
    codigo: str
    fecha_ingreso: date
    fecha_egreso: date
    cantidad_personas: int


class EstadoPagoRetorno(BaseModel):
    estado: EstadoRetorno
    mensaje: str
    reserva: ReservaRetorno
