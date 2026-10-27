import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.reserva import (
    CondicionPersonaEnum, EstadoPagoEnum, EstadoReservaEnum, Reserva, ReservaPersona,
)
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services.pricing_service import PrecioPersona, PricingService

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

INGRESO = hoy_argentina() + timedelta(days=45)
EGRESO = INGRESO + timedelta(days=1)


def _crear_usuario() -> str:
    db = SessionLocal()
    try:
        usuario = User(
            email=f"personas_{uuid.uuid4()}@grupo8.com",
            password_hash="secreto",
            nombre="Usuario Personas",
            dni=str(uuid.uuid4().int)[:8],
            is_socio=False,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        return str(usuario.id)
    finally:
        db.close()


def _payload(user_id, personas, **cambios) -> dict:
    payload = {
        "user_id": user_id,
        "fecha_ingreso": INGRESO.isoformat(),
        "fecha_egreso": EGRESO.isoformat(),
        "personas": personas,
        "email": f"{uuid.uuid4().hex[:10]}@test.com",
        "telefono": "2604123456",
    }
    payload.update(cambios)
    return payload


PERSONAS_MIXTAS = [
    {"nombre": "Ana Pérez", "edad": 34, "condicion": "socio", "dni": "30111222"},
    {"nombre": "Luis Pérez", "edad": 8, "condicion": "visitante"},
    {"nombre": "Marta Gómez", "edad": 61, "condicion": "visitante", "dni": "12345678"},
]


@pytest.fixture
def reservas_creadas(monkeypatch):
    # Estos tests no miran la capacidad, así que la subimos para que no dependa de la BD local
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    ids = []
    yield ids
    # Las personas se borran solas junto con la reserva (ON DELETE CASCADE)
    db = SessionLocal()
    try:
        for reserva_id in ids:
            db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
        db.commit()
    finally:
        db.close()


def _personas_guardadas(reserva_id: str) -> list:
    db = SessionLocal()
    try:
        return (
            db.query(ReservaPersona)
            .filter(ReservaPersona.reserva_id == uuid.UUID(reserva_id))
            .order_by(ReservaPersona.orden)
            .all()
        )
    finally:
        db.close()


def test_se_guardan_los_datos_de_todas_las_personas(reservas_creadas):
    response = client.post("/reservas/", json=_payload(_crear_usuario(), PERSONAS_MIXTAS))

    assert response.status_code == 201, response.text
    reservas_creadas.append(response.json()["id"])
    guardadas = _personas_guardadas(response.json()["id"])

    assert [p.nombre for p in guardadas] == ["Ana Pérez", "Luis Pérez", "Marta Gómez"]
    assert [p.edad for p in guardadas] == [34, 8, 61]
    assert [p.condicion for p in guardadas] == [
        CondicionPersonaEnum.socio, CondicionPersonaEnum.visitante, CondicionPersonaEnum.visitante,
    ]
    assert [p.dni for p in guardadas] == ["30111222", None, "12345678"]


def test_cada_persona_guarda_su_precio_base_descuento_y_precio_final(reservas_creadas, descuentos_fijos):
    response = client.post("/reservas/", json=_payload(_crear_usuario(), PERSONAS_MIXTAS))

    assert response.status_code == 201, response.text
    reservas_creadas.append(response.json()["id"])
    socia, *visitantes = _personas_guardadas(response.json()["id"])

    base = Decimal(str(settings.PRECIO_BASE_POR_PERSONA))
    descuento = Decimal(descuentos_fijos)
    assert socia.precio_base == base
    assert socia.descuento_pct == descuento
    assert socia.precio_final == base * (100 - descuento) / 100
    for visitante in visitantes:
        assert visitante.precio_base == base
        assert visitante.descuento_pct == 0
        assert visitante.precio_final == base


def test_el_monto_total_es_la_suma_de_lo_que_paga_cada_persona(reservas_creadas):
    response = client.post("/reservas/", json=_payload(_crear_usuario(), PERSONAS_MIXTAS))

    assert response.status_code == 201, response.text
    data = response.json()
    reservas_creadas.append(data["id"])
    assert data["monto_total"] == pytest.approx(sum(p["precio_final"] for p in data["personas"]))
    assert data["cantidad_personas"] == len(PERSONAS_MIXTAS)


def test_la_respuesta_devuelve_los_datos_de_las_personas(reservas_creadas, descuentos_fijos):
    response = client.post("/reservas/", json=_payload(_crear_usuario(), PERSONAS_MIXTAS))

    assert response.status_code == 201, response.text
    data = response.json()
    reservas_creadas.append(data["id"])
    assert data["titular"] == "Ana Pérez"  # el titular es la primera persona
    primera = data["personas"][0]
    assert primera["nombre"] == "Ana Pérez"
    assert primera["edad"] == 34
    assert primera["condicion"] == "socio"
    assert primera["dni"] == "30111222"
    assert primera["precio_base"] == settings.PRECIO_BASE_POR_PERSONA
    assert primera["descuento_pct"] == pytest.approx(descuentos_fijos)
    assert data["personas"][1]["dni"] is None


def test_el_mismo_dni_puede_estar_en_reservas_distintas(reservas_creadas):
    user_id = _crear_usuario()
    persona = [{"nombre": "Ana Pérez", "edad": 34, "condicion": "socio", "dni": "30111222"}]

    primera = client.post("/reservas/", json=_payload(user_id, persona))
    segunda = client.post("/reservas/", json=_payload(user_id, persona))

    assert primera.status_code == 201, primera.text
    assert segunda.status_code == 201, segunda.text
    reservas_creadas.extend([primera.json()["id"], segunda.json()["id"]])


def test_si_falla_el_guardado_de_una_persona_no_se_crea_nada(monkeypatch, reservas_creadas):
    # La segunda persona viola la regla de la base (descuento mayor a 100 %): toda la reserva debe revertirse
    original = PricingService.cotizar

    def cotizacion_rota(db, personas):
        cotizacion = original(db, personas)
        precios = list(cotizacion.personas)
        precios[1] = PrecioPersona(Decimal("5000.00"), Decimal("150.00"), Decimal("5000.00"))
        return cotizacion._replace(personas=precios)

    monkeypatch.setattr(PricingService, "cotizar", staticmethod(cotizacion_rota))
    payload = _payload(_crear_usuario(), PERSONAS_MIXTAS)

    response = client.post("/reservas/", json=payload)

    assert response.status_code == 500
    db = SessionLocal()
    try:
        assert db.query(Reserva).filter(Reserva.email == payload["email"]).count() == 0
    finally:
        db.close()


def test_al_borrar_la_reserva_se_borran_sus_personas(reservas_creadas):
    response = client.post("/reservas/", json=_payload(_crear_usuario(), PERSONAS_MIXTAS))
    reserva_id = response.json()["id"]
    assert len(_personas_guardadas(reserva_id)) == 3

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
        db.commit()
    finally:
        db.close()

    assert _personas_guardadas(reserva_id) == []


def test_el_listado_devuelve_las_personas_y_las_reservas_viejas_quedan_sin_personas(reservas_creadas):
    # Otros módulos de test también usan este override: se restaura lo que había al terminar
    override_previo = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = lambda: User(
        id=uuid.uuid4(), email="admin_personas@grupo8.com", rol=RoleEnum.ADMIN
    )
    try:
        user_id = _crear_usuario()
        nueva = client.post(
            "/reservas/",
            json=_payload(user_id, PERSONAS_MIXTAS, fecha_ingreso="2097-01-01", fecha_egreso="2097-01-02"),
        )
        assert nueva.status_code == 201, nueva.text
        reservas_creadas.append(nueva.json()["id"])

        # Una reserva anterior a esta funcionalidad: se guardó sin personas
        db = SessionLocal()
        try:
            vieja = Reserva(
                user_id=uuid.UUID(user_id),
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=date(2097, 1, 1),
                fecha_egreso=date(2097, 1, 1),
                cantidad_personas=2,
                monto_total=10000.0,
                titular="Titular Viejo",
                email="viejo@test.com",
                estado_reserva=EstadoReservaEnum.PENDIENTE,
                estado_pago=EstadoPagoEnum.PENDIENTE,
            )
            db.add(vieja)
            db.commit()
            reservas_creadas.append(str(vieja.id))
            vieja_id = str(vieja.id)
        finally:
            db.close()

        response = client.get("/reservas/?fecha_desde=2097-01-01&limit=100")

        assert response.status_code == 200
        por_id = {r["id"]: r for r in response.json()}
        assert len(por_id[nueva.json()["id"]]["personas"]) == 3
        assert por_id[vieja_id]["personas"] == []
    finally:
        if override_previo is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = override_previo
