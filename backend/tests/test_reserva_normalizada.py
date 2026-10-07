import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.reserva import Reserva, EstadoPagoEnum, EstadoReservaEnum
from models.user import User, RoleEnum
from schemas.reserva import ReservaCreate, hoy_argentina

# Fechas relativas a "hoy" (hora de Argentina, igual que el backend) para que los
# tests no dependan del día en que se ejecutan
INGRESO = hoy_argentina() + timedelta(days=30)
EGRESO = INGRESO + timedelta(days=2)

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

# El GET de reservas es solo para admin (mismo override que usa test_reservas.py)
app.dependency_overrides[get_current_user] = lambda: User(
    id=uuid.uuid4(), email="admin_test@grupo8.com", rol=RoleEnum.ADMIN
)


def _crear_usuario(es_socio=False) -> str:
    db = SessionLocal()
    try:
        usuario = User(
            email=f"norm_{uuid.uuid4()}@grupo8.com",
            password_hash="secreto",
            nombre="Usuario Normalizado",
            dni=str(uuid.uuid4().int)[:8],
            is_socio=es_socio,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        return str(usuario.id)
    finally:
        db.close()


def _payload(user_id, **cambios) -> dict:
    payload = {
        "user_id": user_id,
        "fecha_ingreso": INGRESO.isoformat(),
        "fecha_egreso": EGRESO.isoformat(),
        "cantidad_personas": 2,
        "titular": "Ana Pérez",
        "email": "ana@test.com",
        "telefono": "2604123456",
    }
    payload.update(cambios)
    return payload

def _insertar_reserva(user_id, ids, **campos) -> str:
    """Inserta una reserva directo en la BD y la anota para borrarla al final."""
    datos = dict(
        user_id=uuid.UUID(user_id),
        camping_id=settings.CAMPING_ID,
        fecha_ingreso=date(2026, 12, 20),
        fecha_egreso=date(2026, 12, 20),
        cantidad_personas=2,
        monto_total=10000.0,
        titular="Titular Directo",
        email="directo@test.com",
        estado_reserva=EstadoReservaEnum.PENDIENTE,
        estado_pago=EstadoPagoEnum.PENDIENTE,
    )
    datos.update(campos)
    db = SessionLocal()
    try:
        reserva = Reserva(**datos)
        db.add(reserva)
        db.commit()
        db.refresh(reserva)
        ids.append(str(reserva.id))
        return str(reserva.id)
    finally:
        db.close()


@pytest.fixture
def reservas_creadas(monkeypatch):
    # Estos tests no miran la capacidad, así que la subimos para que no dependa de la BD local
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    ids = []
    yield ids
    # Limpieza: borramos solo lo que creó el test
    db = SessionLocal()
    try:
        for reserva_id in ids:
            db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
        db.commit()
    finally:
        db.close()


# ---------- Modelo y schema (no tocan la BD) ----------

def test_marcar_como_pagada_actualiza_pago_y_estado_de_reserva():
    reserva = Reserva(
        estado_pago=EstadoPagoEnum.PENDIENTE,
        estado_reserva=EstadoReservaEnum.PENDIENTE,
    )

    reserva.marcar_como_pagada()

    assert reserva.estado_pago == EstadoPagoEnum.PAGADO
    assert reserva.estado_reserva == EstadoReservaEnum.CONFIRMADA


def test_schema_acepta_ingreso_y_egreso_el_mismo_dia():
    # Quien pasa el día entra y sale el mismo día
    reserva = ReservaCreate(**_payload(str(uuid.uuid4()), fecha_egreso=INGRESO.isoformat()))

    assert reserva.fecha_ingreso == reserva.fecha_egreso


def test_schema_rechaza_egreso_anterior_al_ingreso():
    antes = (INGRESO - timedelta(days=1)).isoformat()
    with pytest.raises(ValidationError):
        ReservaCreate(**_payload(str(uuid.uuid4()), fecha_egreso=antes))

# ---------- POST /reservas ----------

def test_crear_reserva_guarda_los_datos_normalizados(reservas_creadas):
    user_id = _crear_usuario()

    response = client.post("/reservas/", json=_payload(user_id))

    assert response.status_code == 201
    data = response.json()
    reservas_creadas.append(data["id"])
    assert data["user_id"] == user_id
    assert data["camping_id"] == settings.CAMPING_ID
    assert data["fecha_ingreso"] == INGRESO.isoformat()
    assert data["fecha_egreso"] == EGRESO.isoformat()
    assert data["fecha_reserva"]  # la completa el backend al crear
    assert data["titular"] == "Ana Pérez"
    assert data["email"] == "ana@test.com"
    assert data["telefono"] == "2604123456"
    assert data["estado_reserva"] == EstadoReservaEnum.PENDIENTE.value
    assert data["estado_pago"] == EstadoPagoEnum.PENDIENTE.value
    assert data["monto_total"] == pytest.approx(2 * settings.PRECIO_BASE_POR_PERSONA)


def test_crear_reserva_aplica_descuento_de_socio(reservas_creadas):
    user_id = _crear_usuario(es_socio=True)

    response = client.post("/reservas/", json=_payload(user_id, cantidad_personas=3))

    assert response.status_code == 201
    data = response.json()
    reservas_creadas.append(data["id"])
    esperado = 3 * settings.PRECIO_BASE_POR_PERSONA * (1 - settings.PORCENTAJE_DESCUENTO_SOCIO)
    assert data["monto_total"] == pytest.approx(esperado)


def test_crear_reserva_con_egreso_anterior_al_ingreso_devuelve_422(reservas_creadas):
    user_id = _crear_usuario()
    antes = (INGRESO - timedelta(days=1)).isoformat()

    response = client.post("/reservas/", json=_payload(user_id, fecha_egreso=antes))
    assert response.status_code == 422

@pytest.mark.parametrize("campo", ["titular", "email", "telefono", "fecha_ingreso", "fecha_egreso"])
def test_crear_reserva_sin_campo_obligatorio_devuelve_422(campo, reservas_creadas):
    payload = _payload(_crear_usuario())
    del payload[campo]

    response = client.post("/reservas/", json=payload)

    assert response.status_code == 422


def test_crear_reserva_con_email_invalido_devuelve_422(reservas_creadas):
    response = client.post("/reservas/", json=_payload(_crear_usuario(), email="no-es-un-email"))

    assert response.status_code == 422


def test_crear_reserva_con_usuario_inexistente_devuelve_404(reservas_creadas):
    response = client.post("/reservas/", json=_payload(str(uuid.uuid4())))

    assert response.status_code == 404


def test_cupo_depende_del_estado_de_reserva_y_no_del_pago(monkeypatch, reservas_creadas):
    user_id = _crear_usuario()

    # Dejamos exactamente 2 lugares libres, sin importar lo que haya en la BD local
    db = SessionLocal()
    try:
        ocupados = db.query(func.sum(Reserva.cantidad_personas)).filter(
            Reserva.estado_reserva != EstadoReservaEnum.CANCELADA
        ).scalar() or 0
    finally:
        db.close()
    monkeypatch.setattr(
        settings, "CAMPING_TOTAL_CAPACITY", ocupados + settings.CAMPING_OFFLINE_BUFFER + 2
    )

    # Una reserva cancelada no ocupa lugar aunque su pago figure como pendiente
    _insertar_reserva(user_id, reservas_creadas, cantidad_personas=30,
                      estado_reserva=EstadoReservaEnum.CANCELADA)

    primera = client.post("/reservas/", json=_payload(user_id, cantidad_personas=2))
    assert primera.status_code == 201
    reservas_creadas.append(primera.json()["id"])

    # Ahora sí está lleno
    segunda = client.post("/reservas/", json=_payload(user_id, cantidad_personas=1))
    assert segunda.status_code == 400


# ---------- GET /reservas ----------

def test_listado_filtra_por_fecha_de_ingreso_y_devuelve_los_campos_nuevos(reservas_creadas):
    user_id = _crear_usuario()
    # Fechas lejanas para no mezclarnos con otras reservas de la BD local
    cercana = _insertar_reserva(user_id, reservas_creadas, fecha_ingreso=date(2098, 1, 1),
                                fecha_egreso=date(2098, 1, 1))
    lejana = _insertar_reserva(user_id, reservas_creadas, fecha_ingreso=date(2099, 1, 1),
                               fecha_egreso=date(2099, 1, 3), titular="Titular Lejano")

    response = client.get("/reservas/?fecha_desde=2099-01-01&limit=100")

    assert response.status_code == 200
    por_id = {r["id"]: r for r in response.json()}
    assert lejana in por_id
    assert cercana not in por_id
    assert por_id[lejana]["titular"] == "Titular Lejano"
    assert por_id[lejana]["fecha_egreso"] == "2099-01-03"
    assert por_id[lejana]["estado_reserva"] == EstadoReservaEnum.PENDIENTE.value
