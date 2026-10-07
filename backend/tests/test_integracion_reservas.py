import pytest
from httpx import AsyncClient, ASGITransport
import uuid
from datetime import date, timedelta

from main import app
from core.config import settings
from core.database import SessionLocal
from models.reserva import Reserva
from models.user import User

pytestmark = [pytest.mark.anyio, pytest.mark.usefixtures("camping_de_prueba")]

FECHA_MAÑANA = (date.today() + timedelta(days=1)).isoformat()

# 2. Creamos una función auxiliar para inyectar un usuario real y evitar el Error 500 de Clave Foránea
def crear_usuario_prueba():
    db = SessionLocal()
    nuevo_usuario = User(
        email=f"test_{uuid.uuid4()}@grupo8.com",
        password_hash="secreto",
        nombre="Usuario Test",
        dni=str(uuid.uuid4().int)[:8] # DNI aleatorio
    )
    db.add(nuevo_usuario)
    db.commit()
    db.refresh(nuevo_usuario)
    user_id = str(nuevo_usuario.id)
    db.close()
    return user_id

def borrar_reserva(reserva_id: str):
    # Si no la borramos, cada corrida de los tests deja 2 lugares ocupados en la BD
    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
        db.commit()
    finally:
        db.close()

async def test_flujo_exitoso_crear_reserva(monkeypatch):
    """Criterio de Aceptación 1: Test del flujo exitoso"""

    # Este test prueba el flujo exitoso, no la capacidad: subimos el cupo para que
    # no dependa de cuánta gente haya reservada en la BD local
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    
    # Obtenemos un ID de usuario que SÍ existe en la base de datos
    user_id_real = crear_usuario_prueba()
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        
        payload = {
            "user_id": user_id_real,
            "fecha_ingreso": FECHA_MAÑANA,
            "fecha_egreso": FECHA_MAÑANA,
            "cantidad_personas": 2,
            "titular": "Usuario Test",
            "email": "usuario.test@grupo8.com",
            "telefono": "2604000000"
        }
        
        response = await ac.post("/reservas/", json=payload)
        
        assert response.status_code == 201, response.text
        data = response.json()
        borrar_reserva(data["id"])
        assert data["cantidad_personas"] == 2
        assert "id" in data

async def test_limite_de_capacidad(monkeypatch):
    """Criterio de Aceptación 2: Test de límite de capacidad"""

    # Dejamos un cupo menor al pedido, sin depender de la BD local:
    # disponible = total - activas - buffer <= 5, y se piden 10
    monkeypatch.setattr(
        settings, "CAMPING_TOTAL_CAPACITY", settings.CAMPING_OFFLINE_BUFFER + 5
    )
    user_id_real = crear_usuario_prueba()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "user_id": user_id_real,
            "fecha_ingreso": FECHA_MAÑANA,
            "fecha_egreso": FECHA_MAÑANA,
            "cantidad_personas": settings.MAX_PERSONAS_POR_RESERVA,
            "titular": "Usuario Test",
            "email": "usuario.test@grupo8.com",
            "telefono": "2604000000"
        }

        response = await ac.post("/reservas/", json=payload)

        assert response.status_code == 400
        assert "cupos" in response.json()["detail"].lower()