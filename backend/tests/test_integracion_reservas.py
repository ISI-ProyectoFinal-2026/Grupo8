import pytest
from httpx import AsyncClient, ASGITransport
import uuid
from datetime import date, timedelta

from main import app
from core.config import settings
from core.database import SessionLocal
from models.reserva import Reserva

pytestmark = [pytest.mark.anyio, pytest.mark.usefixtures("camping_de_prueba")]

FECHA_MAÑANA = (date.today() + timedelta(days=1)).isoformat()

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
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        
        payload = {
            "fecha_ingreso": FECHA_MAÑANA,
            "fecha_egreso": FECHA_MAÑANA,
            "personas": [
                {"nombre": "Usuario Test", "edad": 30, "condicion": "visitante"},
                {"nombre": "Acompañante Test", "edad": 8, "condicion": "visitante"},
            ],
            "email": "usuario.test@grupo8.com",
        }
        
        response = await ac.post("/reservas/", json=payload)
        
        assert response.status_code == 201, response.text
        data = response.json()
        borrar_reserva(data["id"])
        assert data["cantidad_personas"] == 2
        assert data["titular"] == "Usuario Test"
        assert [p["nombre"] for p in data["personas"]] == ["Usuario Test", "Acompañante Test"]
        assert "id" in data

async def test_limite_de_capacidad(monkeypatch):
    """Criterio de Aceptación 2: Test de límite de capacidad"""

    # Dejamos un cupo menor al pedido, sin depender de la BD local:
    # disponible = total - activas - buffer <= 5, y se piden 10
    monkeypatch.setattr(
        settings, "CAMPING_TOTAL_CAPACITY", settings.CAMPING_OFFLINE_BUFFER + 5
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        payload = {
            "fecha_ingreso": FECHA_MAÑANA,
            "fecha_egreso": FECHA_MAÑANA,
            "personas": [
                {"nombre": f"Persona Test {chr(65 + i)}", "edad": 30, "condicion": "visitante"}
                for i in range(settings.MAX_PERSONAS_POR_RESERVA)
            ],
            "email": "usuario.test@grupo8.com",
        }

        response = await ac.post("/reservas/", json=payload)

        assert response.status_code == 400
        assert "cupos" in response.json()["detail"].lower()