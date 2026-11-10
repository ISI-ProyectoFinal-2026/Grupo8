"""Avisos auténticos e importe correcto en los pagos de Mercado Pago (Issue 17.3)."""
import hashlib
import hmac
import random
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.pago import Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from services.payment_service import importe_coincide, payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

SECRETO = "secreto-webhook-de-prueba"
MONTO_RESERVA = 15000.0


# ---------- Dobles de prueba ----------

class MercadoPagoFalso:
    """Devuelve los pagos cargados, como el SDK de Mercado Pago, y anota las consultas."""

    def __init__(self):
        self.pagos = {}
        self.consultas = 0

    def payment(self):
        return self

    def get(self, payment_id):
        self.consultas += 1
        return {"status": 200, "response": self.pagos[str(payment_id)]}

    def search(self, filtros):
        self.consultas += 1
        resultados = [
            pago for pago in self.pagos.values()
            if pago["external_reference"] == filtros.get("external_reference")
        ]
        return {"response": {"results": resultados}}


class SecurityServiceFalso:
    def generate_offline_qr_token(self, payload):
        return "jwt-de-prueba"


class EmailServiceFalso:
    def __init__(self):
        self.enviados = []

    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):
        self.enviados.append(datos_reserva["reserva_id"])


# ---------- Fixtures y helpers ----------

@pytest.fixture
def correo(monkeypatch):
    falso = EmailServiceFalso()
    monkeypatch.setattr("services.payment_service.SecurityService", SecurityServiceFalso)
    monkeypatch.setattr("services.payment_service.email_service", falso)
    return falso


@pytest.fixture
def mp(monkeypatch):
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


@pytest.fixture
def secreto(monkeypatch):
    monkeypatch.setattr(settings, "MERCADOPAGO_WEBHOOK_SECRET", SECRETO)
    return SECRETO


@pytest.fixture
def datos():
    """Crea reservas y usuarios de prueba y los borra (con sus pagos) al terminar."""
    reservas, usuarios = [], []

    class Datos:
        @staticmethod
        def usuario(rol=RoleEnum.CLIENTE):
            db = SessionLocal()
            try:
                sufijo = uuid.uuid4().hex[:10]
                usuario = User(
                    email=f"pagos_{sufijo}@grupo8.com",
                    password_hash="no-se-usa",
                    nombre="Usuario Pagos",
                    dni=f"T{sufijo}",
                    rol=rol,
                )
                db.add(usuario)
                db.commit()
                db.refresh(usuario)
                db.expunge(usuario)
                usuarios.append(usuario.id)
                return usuario
            finally:
                db.close()

        @staticmethod
        def reserva(user_id=None):
            db = SessionLocal()
            try:
                reserva = Reserva(
                    user_id=user_id,
                    camping_id=settings.CAMPING_ID,
                    fecha_ingreso=date(2099, 12, 20),
                    fecha_egreso=date(2099, 12, 22),
                    cantidad_personas=3,
                    monto_total=MONTO_RESERVA,
                    titular="Titular Avisos",
                    email="titular.avisos@grupo8.com",
                    estado_reserva=EstadoReservaEnum.PENDIENTE,
                    estado_pago=EstadoPagoEnum.PENDIENTE,
                )
                db.add(reserva)
                db.commit()
                reservas.append(reserva.id)
                return reserva.id
            finally:
                db.close()

    yield Datos

    db = SessionLocal()
    try:
        db.query(Pago).filter(Pago.reserva_id.in_(reservas)).delete(synchronize_session=False)
        db.query(Reserva).filter(Reserva.id.in_(reservas)).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(usuarios)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def sesion():
    """Hace que la reconciliación vea al usuario indicado como el de la sesión."""
    previo = app.dependency_overrides.get(get_current_user)

    def _iniciar(usuario):
        app.dependency_overrides[get_current_user] = lambda: usuario

    yield _iniciar

    if previo is None:
        app.dependency_overrides.pop(get_current_user, None)
    else:
        app.dependency_overrides[get_current_user] = previo


def _cargar_pago(mp, reserva_id, estado="approved", monto=MONTO_RESERVA, detalle="accredited"):
    payment_id = str(random.randint(10**11, 10**12 - 1))
    mp.pagos[payment_id] = {
        "id": int(payment_id),
        "status": estado,
        "status_detail": detalle,
        "external_reference": str(reserva_id),
        "transaction_amount": monto,
        "currency_id": "ARS",
        "payment_method_id": "visa",
    }
    return payment_id


def _firma(data_id, request_id, ts, secreto=SECRETO):
    """Firma como lo hace Mercado Pago: HMAC-SHA256 de id:...;request-id:...;ts:...;"""
    manifiesto = f"id:{data_id};request-id:{request_id};ts:{ts};"
    return hmac.new(secreto.encode(), manifiesto.encode(), hashlib.sha256).hexdigest()


def _aviso(payment_id, firma=None, request_id="req-123", ts="1742505638", id_firmado=None):
    """Envía el aviso como Mercado Pago: data.id en la URL, firma en los headers."""
    headers = {"x-request-id": request_id}
    if firma is None:
        firma = _firma(id_firmado or payment_id, request_id, ts)
    if firma:
        headers["x-signature"] = f"ts={ts},v1={firma}"
    return client.post(
        "/api/payments/webhook",
        params={"data.id": payment_id, "type": "payment"},
        json={"type": "payment", "data": {"id": payment_id}},
        headers=headers,
    )


def _reserva(reserva_id):
    db = SessionLocal()
    try:
        return db.query(Reserva).filter(Reserva.id == reserva_id).one()
    finally:
        db.close()


def _pagos(reserva_id):
    db = SessionLocal()
    try:
        return db.query(Pago).filter(Pago.reserva_id == reserva_id).all()
    finally:
        db.close()


# ---------- Firma del aviso ----------

@pytest.mark.firma_real
def test_aviso_con_firma_valida_se_procesa(mp, correo, secreto, datos):
    reserva_id = datos.reserva()
    payment_id = _cargar_pago(mp, reserva_id)

    response = _aviso(payment_id)

    assert response.status_code == 200
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PAGADO
    assert correo.enviados == [str(reserva_id)]


@pytest.mark.firma_real
@pytest.mark.parametrize(
    "firma, id_firmado",
    [
        ("0" * 64, None),  # hash inventado
        (_firma("123", "req-123", "1742505638", secreto="otra-clave"), None),  # firmado con otra clave
        (None, "999999"),  # firma real de otro pago: no sirve para cambiar el data.id
        ("", None),  # sin header x-signature
    ],
)
def test_aviso_con_firma_invalida_no_se_procesa(mp, correo, secreto, datos, firma, id_firmado):
    reserva_id = datos.reserva()
    payment_id = _cargar_pago(mp, reserva_id)

    response = _aviso(payment_id, firma=firma, id_firmado=id_firmado)

    assert response.status_code == 401
    # Ni siquiera se consulta a Mercado Pago
    assert mp.consultas == 0
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE
    assert _pagos(reserva_id) == []
    assert correo.enviados == []


@pytest.mark.firma_real
def test_sin_clave_secreta_configurada_se_rechazan_los_avisos(mp, correo, monkeypatch, datos):
    monkeypatch.setattr(settings, "MERCADOPAGO_WEBHOOK_SECRET", "")
    reserva_id = datos.reserva()
    payment_id = _cargar_pago(mp, reserva_id)

    response = _aviso(payment_id)

    assert response.status_code == 401
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE


# ---------- Importe ----------

def test_webhook_con_importe_distinto_no_confirma_y_registra_el_pago(mp, correo, datos):
    reserva_id = datos.reserva()
    payment_id = _cargar_pago(mp, reserva_id, monto=100.0)

    response = _aviso(payment_id)

    assert response.status_code == 200
    reserva = _reserva(reserva_id)
    assert reserva.estado_pago == EstadoPagoEnum.PENDIENTE
    assert reserva.estado_reserva == EstadoReservaEnum.PENDIENTE
    assert correo.enviados == []
    # El pago queda guardado con lo que cobró Mercado Pago, para revisarlo
    pagos = _pagos(reserva_id)
    assert len(pagos) == 1
    assert pagos[0].estado == "approved"
    assert float(pagos[0].monto) == 100.0


def test_reconciliacion_con_importe_distinto_no_confirma(mp, correo, datos, como_admin):
    reserva_id = datos.reserva()
    _cargar_pago(mp, reserva_id, monto=MONTO_RESERVA + 1)

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "importe_distinto"
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE
    assert correo.enviados == []
    assert len(_pagos(reserva_id)) == 1


@pytest.mark.parametrize(
    "cobrado, coincide",
    [
        (15000, True),
        (15000.0, True),
        ("15000.00", True),
        (15000.004, True),  # se compara al centavo
        (15000.01, False),
        (14999.99, False),
        (None, False),  # sin importe informado no se confirma
    ],
)
def test_importe_coincide(cobrado, coincide):
    assert importe_coincide(Reserva(monto_total=MONTO_RESERVA), cobrado) is coincide


# ---------- Rechazo ----------

def test_pago_rechazado_deja_la_reserva_pendiente(mp, correo, datos):
    reserva_id = datos.reserva()
    payment_id = _cargar_pago(mp, reserva_id, estado="rejected", detalle="cc_rejected_insufficient_amount")

    response = _aviso(payment_id)

    assert response.status_code == 200
    reserva = _reserva(reserva_id)
    assert reserva.estado_pago == EstadoPagoEnum.PENDIENTE
    assert reserva.estado_reserva == EstadoReservaEnum.PENDIENTE
    assert correo.enviados == []
    assert [pago.estado for pago in _pagos(reserva_id)] == ["rejected"]


def test_rechazo_de_otro_intento_no_toca_una_reserva_ya_pagada(mp, correo, datos):
    reserva_id = datos.reserva()
    _aviso(_cargar_pago(mp, reserva_id))
    _aviso(_cargar_pago(mp, reserva_id, estado="rejected", detalle="cc_rejected_other_reason"))

    reserva = _reserva(reserva_id)
    assert reserva.estado_pago == EstadoPagoEnum.PAGADO
    assert reserva.estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert len(correo.enviados) == 1


# ---------- Quién puede pedir la reconciliación ----------

def test_reconciliacion_sin_sesion_devuelve_401(mp, datos):
    reserva_id = datos.reserva()

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 401
    assert mp.consultas == 0


def test_el_duenio_puede_reconciliar_su_reserva(mp, correo, datos, sesion):
    duenio = datos.usuario()
    reserva_id = datos.reserva(user_id=duenio.id)
    _cargar_pago(mp, reserva_id)
    sesion(duenio)

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "reconciliado"
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PAGADO


def test_otro_cliente_no_puede_reconciliar_una_reserva_ajena(mp, datos, sesion):
    reserva_id = datos.reserva(user_id=datos.usuario().id)
    sesion(datos.usuario())

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 403
    assert mp.consultas == 0


def test_un_cliente_no_puede_reconciliar_una_reserva_sin_cuenta(mp, datos, sesion):
    reserva_id = datos.reserva(user_id=None)
    sesion(datos.usuario())

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 403


def test_un_admin_puede_reconciliar_cualquier_reserva(mp, correo, datos, sesion):
    reserva_id = datos.reserva(user_id=None)
    _cargar_pago(mp, reserva_id)
    sesion(datos.usuario(rol=RoleEnum.ADMIN))

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "reconciliado"


def test_seguridad_no_puede_reconciliar(mp, datos, sesion):
    reserva_id = datos.reserva(user_id=None)
    sesion(datos.usuario(rol=RoleEnum.SEGURIDAD))

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 403


# ---------- test-user ----------

def test_test_user_no_esta_disponible_en_produccion(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    response = client.get("/api/payments/test-user")

    assert response.status_code == 404


def test_test_user_sigue_disponible_en_desarrollo(monkeypatch):
    monkeypatch.setattr(settings, "ENVIRONMENT", "development")

    response = client.get("/api/payments/test-user")

    assert response.status_code == 200
    assert "user_id" in response.json()
