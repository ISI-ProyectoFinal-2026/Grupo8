import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.reserva import Reserva
from models.user import User
from services.usuario_prueba_service import EMAIL_USUARIO_PRUEBA

# Crea las tablas si todavía no existen (igual que test_reservas.py)
Base.metadata.create_all(bind=engine)

client = TestClient(app)


def test_usuario_prueba_devuelve_un_usuario_existente_en_la_bd():
    response = client.get("/usuarios/prueba")

    assert response.status_code == 200
    user_id = uuid.UUID(response.json()["user_id"])

    db = SessionLocal()
    try:
        assert db.query(User).filter(User.id == user_id).first() is not None
    finally:
        db.close()


def test_usuario_prueba_es_idempotente():
    primero = client.get("/usuarios/prueba").json()["user_id"]
    segundo = client.get("/usuarios/prueba").json()["user_id"]
    assert primero == segundo

    db = SessionLocal()
    try:
        cantidad = db.query(User).filter(User.email == EMAIL_USUARIO_PRUEBA).count()
    finally:
        db.close()
    assert cantidad == 1


def test_usuario_prueba_no_disponible_en_produccion(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    response = client.get("/usuarios/prueba")

    assert response.status_code == 404


def test_se_puede_crear_una_reserva_con_el_usuario_de_prueba(monkeypatch):
    """Reproduce el flujo del frontend: pedir el user_id y crear la reserva."""
    # Este test verifica el flujo usuario -> reserva, no la capacidad del camping.
    # Subimos el cupo para que no dependa de cuántas reservas haya en la base local.
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)

    user_id = client.get("/usuarios/prueba").json()["user_id"]

    response = client.post(
        "/reservas/",
        json={
            "user_id": user_id,
            "fecha_reserva": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "cantidad_personas": 1,
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["user_id"] == user_id

    # Limpieza: borramos solo la reserva creada para no ocupar cupos en la BD local
    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == uuid.UUID(data["id"])).delete()
        db.commit()
    finally:
        db.close()