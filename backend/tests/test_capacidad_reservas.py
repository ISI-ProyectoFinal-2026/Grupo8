import pytest
import uuid
from datetime import date, timedelta
from fastapi.testclient import TestClient

from main import app
from core.dependencies import get_current_user
from models.user import User, RoleEnum

# 1. Configuramos el cliente de pruebas local
client = TestClient(app)

# 2. Simulamos un usuario logueado para que no nos dé error 401 (No autorizado)
def override_get_current_user():
    return User(
        id=uuid.uuid4(), 
        email="admin_test@grupo8.com", 
        rol=RoleEnum.ADMIN,
        is_socio=True
    )

app.dependency_overrides[get_current_user] = override_get_current_user

def test_reserva_otra_fecha_no_reduce_capacidad():
    """
    Verifica que una reserva en una fecha futura no reduzca la disponibilidad
    de las fechas actuales solicitadas.
    """
    fecha_futura_in = date.today() + timedelta(days=30)
    fecha_futura_out = date.today() + timedelta(days=32)
    
    # Usamos un ID con formato válido para la base de datos
    user_id_prueba = str(uuid.uuid4())
    
    # PASO 1: Simular que creamos una reserva previa en el mes que viene que ocupa TODA la capacidad
    payload_reserva_futura = {
        "user_id": user_id_prueba,
        "fecha_ingreso": str(fecha_futura_in),
        "fecha_egreso": str(fecha_futura_out),
        "cantidad_personas": 100, # Supongamos que 100 es el máximo del camping
        "titular": "Socio de prueba",
        "email": "test@qamp.com",
        "telefono": "123456789"
    }
    client.post("/reservas/", json=payload_reserva_futura)

    # PASO 2: Intentar hacer una reserva HOY para 2 personas
    fecha_hoy = date.today()
    payload_reserva_hoy = {
        "user_id": user_id_prueba,
        "fecha_ingreso": str(fecha_hoy),
        "fecha_egreso": str(fecha_hoy + timedelta(days=2)),
        "cantidad_personas": 2,
        "titular": "Emiliana Bianchi",
        "email": "emi@qamp.com",
        "telefono": "987654321"
    }
    
    response = client.post("/reservas/", json=payload_reserva_hoy)
    
    # PASO 3: Afirmar que el sistema NO la rechazó por falta de cupo (Error 400)
    assert response.status_code != 400