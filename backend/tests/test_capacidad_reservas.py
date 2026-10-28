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
    
    # PASO 1: Simular que creamos una reserva previa en el mes que viene que ocupa TODA la capacidad
    payload_reserva_futura = {
        "fecha_ingreso": str(fecha_futura_in),
        "fecha_egreso": str(fecha_futura_out),
        "personas": [
            {"nombre": "Socio de prueba", "edad": 40, "condicion": "visitante"},
            {"nombre": "Acompañante de prueba", "edad": 38, "condicion": "visitante"},
        ],
        "email": "test@qamp.com",
    }
    client.post("/reservas/", json=payload_reserva_futura)

    # PASO 2: Intentar hacer una reserva HOY para 2 personas
    fecha_hoy = date.today()
    payload_reserva_hoy = {
        "fecha_ingreso": str(fecha_hoy),
        "fecha_egreso": str(fecha_hoy + timedelta(days=2)),
        "personas": [
            {"nombre": "Emiliana Bianchi", "edad": 29, "condicion": "visitante"},
            {"nombre": "Lucía Bianchi", "edad": 27, "condicion": "visitante"},
        ],
        "email": "emi@qamp.com",
    }
    
    response = client.post("/reservas/", json=payload_reserva_hoy)
    
    # PASO 3: Afirmar que el sistema NO la rechazó por falta de cupo (Error 400)
    assert response.status_code != 400