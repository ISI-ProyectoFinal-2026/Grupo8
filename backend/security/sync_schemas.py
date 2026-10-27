from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, TypeAdapter


class IngresoQRItem(BaseModel):
    """Ingreso escaneado con QR (siempre trae reserva)."""
    tipo_ingreso: Literal["QR"]
    jti: str = Field(..., min_length=1, max_length=64)
    reserva_id: UUID
    fecha_escaneo: datetime
    cantidad_personas: int = Field(1, ge=1)


class IngresoManualItem(BaseModel):
    """Ingreso cargado a mano por el guardia, con cobro en efectivo."""
    tipo_ingreso: Literal["MANUAL"]
    jti: str = Field(..., min_length=1, max_length=64)
    reserva_id: Optional[UUID] = None
    fecha_escaneo: datetime
    cantidad_personas: int = Field(..., ge=1)
    monto_cobrado: Decimal = Field(..., ge=0, max_digits=10, decimal_places=2)
    nombre: str = Field(..., min_length=1, max_length=120)
    dni: str = Field(..., min_length=1, max_length=20)


# Se elige la clase según el valor de "tipo_ingreso"
IngresoItem = Annotated[
    Union[IngresoQRItem, IngresoManualItem],
    Field(discriminator="tipo_ingreso"),
]
ingreso_item_adapter: TypeAdapter[Union[IngresoQRItem, IngresoManualItem]] = TypeAdapter(IngresoItem)


class SyncIngresosRequest(BaseModel):
    """Lote de la PWA. Los ítems llegan crudos y se validan de a uno en el endpoint."""
    ingresos: List[Any]


class ErrorIngreso(BaseModel):
    indice: int
    jti: Optional[str] = None
    motivo: str


class SyncIngresosResponse(BaseModel):
    procesados: int
    conflictos: int
    sincronizados_jti: List[str]  # la PWA borra estos de su cola
    errores: List[ErrorIngreso]   # estos quedan en la cola