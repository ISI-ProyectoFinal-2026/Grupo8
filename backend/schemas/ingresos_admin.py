import enum
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from schemas.reserva import TipoClienteEnum


class TipoIngresoAdmin(str, enum.Enum):
    # "web": escaneo del QR de una reserva hecha en la web | "manual": registro manual del guardia
    web = "web"
    manual = "manual"


class IngresoAdmin(BaseModel):
    """Una fila del historial de ingresos del panel."""

    id: UUID
    # Instante en UTC. El panel lo muestra en hora de Buenos Aires
    fecha_hora_ingreso: datetime
    # None en los ingresos manuales: el panel muestra "Manual"
    reserva_id: Optional[UUID]
    personas: int
    tipo_cliente: TipoClienteEnum
    tipo_ingreso: TipoIngresoAdmin


class IngresosPaginados(BaseModel):
    """Respuesta de GET /api/v1/admin/ingresos: la página pedida, el total y los días que se consultaron."""

    desde: date
    hasta: date
    total: int
    items: List[IngresoAdmin]
