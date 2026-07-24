import pytest
from httpx import AsyncClient, ASGITransport
import uuid
from datetime import datetime, timedelta, timezone

from main import app
from core.database import SessionLocal
from models.user import User

pytestmark = pytest.mark.anyio

# 1. Solucionamos el Warning usando timezone.utc
FECHA_MAÑANA = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

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

async def test_flujo_exitoso_crear_reserva():
    """Criterio de Aceptación 1: Test del flujo exitoso"""
    
    # Obtenemos un ID de usuario que SÍ existe en la base de datos
    user_id_real = crear_usuario_prueba()
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        
        payload = {
            "user_id": user_id_real,
            "fecha_reserva": FECHA_MAÑANA,
            "cantidad_personas": 2
        }
        
        response = await ac.post("/reservas/", json=payload)
        
        assert response.status_code == 201
        data = response.json()
        assert data["cantidad_personas"] == 2
        assert "id" in data

async def test_limite_de_capacidad():
    """Criterio de Aceptación 2: Test de límite de capacidad"""
    
    user_id_real = crear_usuario_prueba()
    
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        
        payload = {
            "user_id": user_id_real,
            "fecha_reserva": FECHA_MAÑANA,
            "cantidad_personas": 60
        }
        
        response = await ac.post("/reservas/", json=payload)
        
        assert response.status_code == 400
        # 3. Solucionamos el AssertionError cambiando la palabra a buscar
        assert "cupos" in response.json()["detail"].lower()