from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

class AlertaClonacionOut(BaseModel):
    reserva_id: UUID
    titular: str
    fecha_alerta_clonacion: Optional[datetime]