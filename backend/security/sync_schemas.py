from pydantic import BaseModel, Field
from typing import List
from uuid import UUID
from datetime import datetime

class IngresoOfflineItem(BaseModel):
    """Representa un único registro escaneado sin internet"""
    jti: str = Field(..., description="ID único del token QR para evitar duplicados")
    reserva_id: UUID = Field(..., description="UUID de la reserva escaneada")
    fecha_escaneo: datetime = Field(..., description="El momento exacto en que el guardia leyó el QR offline")

class SyncIngresosRequest(BaseModel):
    """El paquete completo (Batch) que envía la PWA"""
    ingresos: List[IngresoOfflineItem]

class SyncIngresosResponse(BaseModel):
    """Respuesta del servidor indicando qué registros se pueden borrar localmente"""
    sincronizados: List[str]  # Lista de JTIs procesados con éxito
    errores: List[str]        # Lista de JTIs que fallaron (para logs)
    
    
