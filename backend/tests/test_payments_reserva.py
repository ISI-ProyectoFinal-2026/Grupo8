import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.reserva import Reserva, EstadoPagoEnum, EstadoReservaEnum
from models.user import User
from services.payment_service import payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado
pytestmark = pytest.mark.usefixtures("camping_de_prueba")


class MercadoPagoFalso:
    """Reemplaza al SDK para no pegarle a Mercado Pago en los tests."""

    def __init__(self, estado_pago="approved", reserva_id=None, resultados_busqueda=None):
        self.estado_pago = estado_pago
        self.reserva_id = reserva_id
        self.resultados_busqueda = resultados_busqueda or []
        self.preferencia = None

    def payment(self):
        return self

    def preference(self):
        return self

    def get(self, payment_id):
        return {
            "status": 200,
            "response": {"status": self.estado_pago, "external_reference": self.reserva_id},
        }

    def search(self, filtros):
        return {"response": {"results": self.resultados_busqueda}}

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

    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):  # <-- mismo nombre que usa payments.py
        EmailServiceFalso.enviados.append({
            "destinatario": destinatario,
            "datos_reserva": datos_reserva,
            "jwt_token": jwt_token,
        })


@pytest.fixture
def servicios_falsos(monkeypatch):
    SecurityServiceFalso.payloads = []
    EmailServiceFalso.enviados = []
    monkeypatch.setattr("api.payments.SecurityService", SecurityServiceFalso)
    monkeypatch.setattr("api.payments.email_service", EmailServiceFalso())


@pytest.fixture
def reserva_pendiente():
    """Reserva pendiente con titular distinto al usuario, para verificar de dónde salen los datos."""
    db = SessionLocal()
    try:
        usuario = User(
            email=f"pago_{uuid.uuid4()}@grupo8.com",
            password_hash="secreto",
            nombre="Usuario Logueado",
            dni=str(uuid.uuid4().int)[:8],
            is_socio=False,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)

        reserva = Reserva(
            user_id=usuario.id,
            camping_id=settings.CAMPING_ID,
            # Fechas lejanas para que el exp del QR siempre quede en el futuro
            fecha_ingreso=date(2099, 12, 20),
            fecha_egreso=date(2099, 12, 22),
            cantidad_personas=3,
            monto_total=15000.0,
            titular="Titular Real",
            email="titular@real.com",
            telefono="2604123456",
            estado_reserva=EstadoReservaEnum.PENDIENTE,
            estado_pago=EstadoPagoEnum.PENDIENTE,
        )
        db.add(reserva)
        db.commit()
        db.refresh(reserva)
        reserva_id = reserva.id
    finally:
        db.close()

    yield reserva_id

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == reserva_id).delete()
        db.commit()
    finally:
        db.close()


def _estados(reserva_id):
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == reserva_id).first()
        return reserva.estado_pago, reserva.estado_reserva
    finally:
        db.close()


def _llamar_webhook():
    return client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": "123"}})


# ---------- Webhook ----------

def test_webhook_pago_aprobado_confirma_la_reserva_y_manda_el_mail(
    monkeypatch, servicios_falsos, reserva_pendiente
):
    monkeypatch.setattr(payment_service, "mp", MercadoPagoFalso(reserva_id=str(reserva_pendiente)))

    response = _llamar_webhook()

    assert response.status_code == 200
    assert _estados(reserva_pendiente) == (EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA)

    # El mail va al email y al nombre del titular, no al user_id
    assert len(EmailServiceFalso.enviados) == 1
    envio = EmailServiceFalso.enviados[0]
    assert envio["destinatario"] == "titular@real.com"
    assert envio["datos_reserva"]["nombre_cliente"] == "Titular Real"
    assert envio["datos_reserva"]["fecha_ingreso"] == "2099-12-20"
    assert envio["jwt_token"] == "jwt-de-prueba"


def test_webhook_arma_el_payload_del_qr_con_los_datos_de_la_reserva(
    monkeypatch, servicios_falsos, reserva_pendiente
):
    monkeypatch.setattr(payment_service, "mp", MercadoPagoFalso(reserva_id=str(reserva_pendiente)))

    _llamar_webhook()

    assert len(SecurityServiceFalso.payloads) == 1
    payload = SecurityServiceFalso.payloads[0]
    assert payload.reserva_id == str(reserva_pendiente)
    assert payload.camping_id == settings.CAMPING_ID
    assert payload.cantidad_personas == 3
    assert payload.typ == "visitante"
    assert payload.dat == "2099-12-20"
    assert payload.exp > payload.iat


def test_webhook_duplicado_no_reenvia_el_mail(monkeypatch, servicios_falsos, reserva_pendiente):
    monkeypatch.setattr(payment_service, "mp", MercadoPagoFalso(reserva_id=str(reserva_pendiente)))

    _llamar_webhook()
    _llamar_webhook()

    assert len(EmailServiceFalso.enviados) == 1


def test_webhook_pago_rechazado_no_cambia_los_estados(
    monkeypatch, servicios_falsos, reserva_pendiente
):
    monkeypatch.setattr(
        payment_service, "mp",
        MercadoPagoFalso(estado_pago="rejected", reserva_id=str(reserva_pendiente)),
    )

    response = _llamar_webhook()

    assert response.status_code == 200
    assert _estados(reserva_pendiente) == (EstadoPagoEnum.PENDIENTE, EstadoReservaEnum.PENDIENTE)
    assert EmailServiceFalso.enviados == []


# ---------- Crear preferencia ----------

def test_crear_preferencia_cobra_el_monto_guardado_en_la_reserva(monkeypatch, reserva_pendiente):
    mp = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", mp)

    response = client.post(
        "/api/payments/create",
        json={"title": "Entrada General - 3 personas", "reserva_id": str(reserva_pendiente)},
    )

    assert response.status_code == 200
    assert response.json()["init_point"] == "https://mp.test/init"
    assert mp.preferencia["items"][0]["unit_price"] == 15000.0
    assert mp.preferencia["external_reference"] == str(reserva_pendiente)


def test_crear_preferencia_con_reserva_inexistente_devuelve_404(monkeypatch):
    monkeypatch.setattr(payment_service, "mp", MercadoPagoFalso())

    response = client.post(
        "/api/payments/create",
        json={"title": "Reserva", "reserva_id": str(uuid.uuid4())},
    )

    assert response.status_code == 404


# ---------- Reconciliación manual ----------

def test_reconciliar_pago_aprobado_confirma_la_reserva(monkeypatch, reserva_pendiente):
    monkeypatch.setattr(
        payment_service, "mp",
        MercadoPagoFalso(resultados_busqueda=[{"id": 99, "status": "approved"}]),
    )

    response = client.get(f"/api/payments/reconcile/{reserva_pendiente}")

    assert response.status_code == 200
    assert response.json()["status"] == "reconciliado"
    assert _estados(reserva_pendiente) == (EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA)
