import time
import uuid
from datetime import date, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services.payment_service import payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

INGRESO = hoy_argentina() + timedelta(days=60)
EGRESO = INGRESO + timedelta(days=1)

PERSONAS_MIXTAS = [
    {"nombre": "Ana Pérez", "edad": 34, "condicion": "socio", "dni": "30111222"},
    {"nombre": "Luis Pérez", "edad": 8, "condicion": "visitante"},
]


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion():
    """Otros módulos de test reemplazan get_current_user para toda la sesión.
    Acá se usan tokens reales, así que se quita el reemplazo mientras corre cada test."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture
def limpieza(monkeypatch):
    """Sube el cupo (no dependemos de la BD local) y borra lo que crea cada test."""
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    creados = {"reservas": [], "usuarios": []}
    yield creados
    db = SessionLocal()
    try:
        for reserva_id in creados["reservas"]:
            db.query(Reserva).filter(Reserva.id == uuid.UUID(str(reserva_id))).delete()
        db.commit()
        for usuario_id in creados["usuarios"]:
            db.query(User).filter(User.id == uuid.UUID(str(usuario_id))).delete()
        db.commit()
    finally:
        db.close()


def _crear_usuario(limpieza, rol=RoleEnum.CLIENTE) -> str:
    db = SessionLocal()
    try:
        usuario = User(
            email=f"sincuenta_{uuid.uuid4()}@grupo8.com",
            password_hash="secreto",
            nombre="Usuario Sin Cuenta",
            dni=str(uuid.uuid4().int)[:8],
            rol=rol,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        limpieza["usuarios"].append(str(usuario.id))
        return str(usuario.id)
    finally:
        db.close()


def _headers(user_id, **claims) -> dict:
    token = jwt.encode({"sub": str(user_id), **claims}, settings.AUTH_SECRET_KEY, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _payload(**cambios) -> dict:
    payload = {
        "fecha_ingreso": INGRESO.isoformat(),
        "fecha_egreso": EGRESO.isoformat(),
        "personas": PERSONAS_MIXTAS,
        "email": f"{uuid.uuid4().hex[:10]}@test.com",
    }
    payload.update(cambios)
    return payload


def _reservar(limpieza, headers=None, **cambios):
    response = client.post("/reservas/", json=_payload(**cambios), headers=headers or {})
    if response.status_code == 201:
        limpieza["reservas"].append(response.json()["id"])
    return response


# ---------- POST /reservas con y sin sesión ----------

def test_un_visitante_sin_sesion_puede_reservar(limpieza):
    response = _reservar(limpieza)

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["user_id"] is None
    assert data["estado_reserva"] == EstadoReservaEnum.PENDIENTE.value
    assert data["cantidad_personas"] == 2


def test_la_reserva_sin_sesion_se_guarda_sin_usuario_en_la_bd(limpieza):
    reserva_id = _reservar(limpieza).json()["id"]

    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).first()
        assert reserva.user_id is None
    finally:
        db.close()


def test_con_sesion_la_reserva_queda_asociada_al_usuario_del_token(limpieza):
    usuario_id = _crear_usuario(limpieza)

    response = _reservar(limpieza, headers=_headers(usuario_id))

    assert response.status_code == 201, response.text
    assert response.json()["user_id"] == usuario_id


def test_el_user_id_que_manda_el_cliente_no_se_usa(limpieza):
    titular_real = _crear_usuario(limpieza)
    otro = _crear_usuario(limpieza)

    con_sesion = _reservar(limpieza, headers=_headers(titular_real), user_id=otro)
    sin_sesion = _reservar(limpieza, user_id=otro)

    assert con_sesion.json()["user_id"] == titular_real
    assert sin_sesion.json()["user_id"] is None


def test_un_token_invalido_devuelve_401_y_no_crea_la_reserva(limpieza):
    response = client.post(
        "/reservas/", json=_payload(), headers={"Authorization": "Bearer no-es-un-jwt"}
    )

    assert response.status_code == 401


def test_un_token_vencido_devuelve_401(limpieza):
    usuario_id = _crear_usuario(limpieza)

    response = client.post(
        "/reservas/",
        json=_payload(),
        headers=_headers(usuario_id, exp=int(time.time()) - 60),
    )

    assert response.status_code == 401


def test_un_token_de_un_usuario_que_no_existe_devuelve_401(limpieza):
    response = client.post("/reservas/", json=_payload(), headers=_headers(uuid.uuid4()))

    assert response.status_code == 401


def test_reservar_sin_sesion_sigue_validando_los_datos(limpieza):
    antes = (INGRESO - timedelta(days=1)).isoformat()

    egreso_invalido = client.post("/reservas/", json=_payload(fecha_egreso=antes))
    sin_personas = client.post("/reservas/", json=_payload(personas=[]))

    assert egreso_invalido.status_code == 422
    assert sin_personas.status_code == 422


def test_reservar_sin_sesion_sigue_controlando_la_capacidad(limpieza, monkeypatch):
    # Cupo en cero: aunque no haya sesión, la reserva no entra
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 0)

    response = client.post("/reservas/", json=_payload())

    assert response.status_code == 400


def test_el_precio_sin_sesion_sale_del_backend(limpieza, descuentos_fijos):
    response = _reservar(limpieza, monto_total=1)

    base = settings.PRECIO_BASE_POR_PERSONA
    esperado = base * (1 - descuentos_fijos / 100) + base
    assert response.json()["monto_total"] == pytest.approx(esperado)


# ---------- GET /reservas/mias ----------

def test_mis_reservas_sin_token_devuelve_401():
    response = client.get("/reservas/mias")

    assert response.status_code == 401


def test_mis_reservas_con_token_invalido_devuelve_401():
    response = client.get("/reservas/mias", headers={"Authorization": "Bearer no-es-un-jwt"})

    assert response.status_code == 401


def test_mis_reservas_sin_reservas_devuelve_lista_vacia(limpieza):
    usuario_id = _crear_usuario(limpieza)

    response = client.get("/reservas/mias", headers=_headers(usuario_id))

    assert response.status_code == 200
    assert response.json() == []


def test_mis_reservas_devuelve_solo_las_del_usuario_autenticado(limpieza):
    yo = _crear_usuario(limpieza)
    otro = _crear_usuario(limpieza)
    mia = _reservar(limpieza, headers=_headers(yo)).json()["id"]
    de_otro = _reservar(limpieza, headers=_headers(otro)).json()["id"]
    anonima = _reservar(limpieza).json()["id"]

    response = client.get("/reservas/mias", headers=_headers(yo))

    assert response.status_code == 200
    ids = [r["id"] for r in response.json()]
    assert ids == [mia]
    assert de_otro not in ids
    assert anonima not in ids


def test_mis_reservas_ignora_un_user_id_enviado_por_query(limpieza):
    yo = _crear_usuario(limpieza)
    otro = _crear_usuario(limpieza)
    _reservar(limpieza, headers=_headers(otro))

    response = client.get(f"/reservas/mias?user_id={otro}", headers=_headers(yo))

    assert response.status_code == 200
    assert response.json() == []


def test_mis_reservas_incluye_las_personas_y_la_cantidad_de_socios(limpieza):
    yo = _crear_usuario(limpieza)
    _reservar(limpieza, headers=_headers(yo))

    data = client.get("/reservas/mias", headers=_headers(yo)).json()

    assert len(data) == 1
    assert [p["nombre"] for p in data[0]["personas"]] == ["Ana Pérez", "Luis Pérez"]
    assert data[0]["cantidad_personas"] == 2
    assert data[0]["cantidad_socios"] == 1
    assert data[0]["user_id"] == yo


def test_mis_reservas_viene_ordenado_por_fecha_de_ingreso_descendente(limpieza):
    yo = _crear_usuario(limpieza)
    cerca = _reservar(
        limpieza, headers=_headers(yo),
        fecha_ingreso=(INGRESO).isoformat(), fecha_egreso=(INGRESO).isoformat(),
    ).json()["id"]
    lejos = _reservar(
        limpieza, headers=_headers(yo),
        fecha_ingreso=(INGRESO + timedelta(days=10)).isoformat(),
        fecha_egreso=(INGRESO + timedelta(days=10)).isoformat(),
    ).json()["id"]

    ids = [r["id"] for r in client.get("/reservas/mias", headers=_headers(yo)).json()]

    assert ids == [lejos, cerca]


def test_mis_reservas_incluye_las_canceladas_para_que_el_cliente_las_vea(limpieza):
    yo = _crear_usuario(limpieza)
    reserva_id = _reservar(limpieza, headers=_headers(yo)).json()["id"]
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).first()
        reserva.estado_reserva = EstadoReservaEnum.CANCELADA
        db.commit()
    finally:
        db.close()

    data = client.get("/reservas/mias", headers=_headers(yo)).json()

    assert [(r["id"], r["estado_reserva"]) for r in data] == [(reserva_id, EstadoReservaEnum.CANCELADA.value)]


# ---------- El listado general sigue siendo solo para admin ----------

def test_el_listado_general_no_lo_ve_un_cliente(limpieza):
    cliente = _crear_usuario(limpieza)

    response = client.get("/reservas/", headers=_headers(cliente))

    assert response.status_code == 403


def test_el_listado_general_no_lo_ve_un_visitante_sin_sesion():
    response = client.get("/reservas/")

    assert response.status_code == 401


# ---------- Pago de una reserva sin cuenta ----------

class MercadoPagoFalso:
    """Reemplaza al SDK de Mercado Pago para que el test no salga a la red."""

    def __init__(self, reserva_id=None):
        self.reserva_id = reserva_id
        self.preferencia = None

    def payment(self):
        return self

    def preference(self):
        return self

    def get(self, payment_id):
        return {
            "status": 200,
            "response": {"status": "approved", "external_reference": self.reserva_id},
        }

    def search(self, filtros):
        return {"response": {"results": []}}

    def create(self, datos):
        self.preferencia = datos
        return {"status": 201, "response": {"sandbox_init_point": "https://mp.test/init"}}


class SecurityServiceFalso:
    payloads = []

    def generate_offline_qr_token(self, payload):
        SecurityServiceFalso.payloads.append(payload)
        return "jwt-de-prueba"


class EmailServiceFalso:
    enviados = []

    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):
        EmailServiceFalso.enviados.append(destinatario)


def test_se_puede_crear_el_pago_de_una_reserva_sin_cuenta(limpieza, monkeypatch):
    reserva = _reservar(limpieza).json()
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)

    response = client.post(
        "/api/payments/create", json={"title": "Reserva Qamp", "reserva_id": reserva["id"]}
    )

    assert response.status_code == 200, response.text
    assert falso.preferencia["items"][0]["unit_price"] == pytest.approx(reserva["monto_total"])


def test_el_webhook_confirma_una_reserva_sin_cuenta_y_manda_el_qr_al_email(limpieza, monkeypatch):
    reserva = _reservar(limpieza).json()
    SecurityServiceFalso.payloads = []
    EmailServiceFalso.enviados = []
    monkeypatch.setattr(payment_service, "mp", MercadoPagoFalso(reserva_id=reserva["id"]))
    monkeypatch.setattr("api.payments.SecurityService", SecurityServiceFalso)
    monkeypatch.setattr("api.payments.email_service", EmailServiceFalso())

    response = client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": "123"}})

    assert response.status_code == 200
    db = SessionLocal()
    try:
        guardada = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva["id"])).first()
        assert guardada.estado_pago == EstadoPagoEnum.PAGADO
        assert guardada.estado_reserva == EstadoReservaEnum.CONFIRMADA
    finally:
        db.close()
    # Sin cuenta no hay socio detrás de la reserva: el QR sale como visitante
    assert [p.typ for p in SecurityServiceFalso.payloads] == ["visitante"]
    assert EmailServiceFalso.enviados == [reserva["email"]]
