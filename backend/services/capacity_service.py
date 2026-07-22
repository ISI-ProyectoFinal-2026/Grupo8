from fastapi import HTTPException
from core.config import settings

class CapacityService:
    def check_availability(self, espacios_solicitados: int, reservas_activas: int) -> bool:
        """
        Calcula si hay cupo disponible considerando la capacidad total, 
        las reservas ya activas y el buffer para reservas offline.
        """
        # Fórmula: Capacidad Total - Reservas Activas - Buffer Offline
        capacidad_disponible = settings.CAMPING_TOTAL_CAPACITY - reservas_activas - settings.CAMPING_OFFLINE_BUFFER
        
        # Validar si los espacios que pide el usuario superan lo disponible
        if espacios_solicitados > capacidad_disponible:
            raise HTTPException(
                status_code=400, 
                detail="No hay cupos suficientes disponibles en el camping."
            )
            
        return True