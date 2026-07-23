import pytest
from fastapi import HTTPException
from services.capacity_service import CapacityService
from core.config import settings

def test_check_availability_success():
    servicio = CapacityService()
    # Simulamos que piden 2 espacios y hay 10 reservas activas
    # Capacidad (50) - Activas (10) - Buffer (5) = 35 disponibles
    resultado = servicio.check_availability(espacios_solicitados=2, reservas_activas=10)
    
    assert resultado is True

def test_check_availability_no_hay_cupo_lanza_400():
    servicio = CapacityService()
    # Simulamos que piden 40 espacios y ya hay 10 reservas activas
    # Capacidad (50) - Activas (10) - Buffer (5) = 35 disponibles. ¡Pide 40, debe fallar!
    
    with pytest.raises(HTTPException) as excinfo:
        servicio.check_availability(espacios_solicitados=40, reservas_activas=10)
        
    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "No hay cupos suficientes disponibles en el camping."