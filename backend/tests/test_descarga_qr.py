"""Descarga del QR desde Mis reservas: GET /reservas/{id}/qr con el mismo jti que el correo."""
import random
import uuid
from datetime import date

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.pago import Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from security.services import SecurityService
from services.payment_service import payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

FIRMA_PNG = b"\x89PNG\r\n\x1a\n"


# ---------- Dobles y fixtures ----------

class MercadoPagoFalso:
    def __init__(self):
        self.pagos = {}

    def payment(self):
        return self

    def get(self, payment_id):
        return {"status": 200, "response": self.pagos[str(payment_id)]}


@pytest.fixture(scope="module")
def claves_es256():
    """Par de claves efímero, generado en memoria."""
    privada = ec.generate_private_key(ec.SECP256R1())
    privada_pem = privada.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    publica_pem = privada.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return privada_pem, publica_pem


@pytest.fixture(autouse=True)
def seguridad_con_clave_efimera(monkeypatch, claves_es256):
    privada_pem, _ = claves_es256
    monkeypatch.setattr(
        "services.payment_service.SecurityService", lambda: SecurityService(private_key=privada_pem)
    )


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion():
    """Acá se usan tokens reales: se quita el reemplazo de get_current_user mientras corre cada test."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture
def mp(monkeypatch):
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


@pytest.fixture
def datos():
    """Crea usuarios y reservas, y los borra (junto con sus pagos) al terminar."""
    creados = {"usuarios": [], "reservas": []}

    def crear_usuario():
        db = SessionLocal()
        try:
            usuario = User(
                email=f"qr_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre="Usuario QR",
                dni=str(uuid.uuid4().int)[:8],
                rol=RoleEnum.CLIENTE,
            )
            db.add(usuario)
            db.commit()
            creados["usuarios"].append(usuario.id)
            return usuario.id
        finally:
            db.close()

    def crear_reserva(usuario_id, estado_pago=EstadoPagoEnum.PENDIENTE, estado_reserva=EstadoReservaEnum.PENDIENTE):
        db = SessionLocal()
        try:
            reserva = Reserva(
                user_id=usuario_id,
                camping_id=settings.CAMPING_ID,
                # Fechas lejanas: el exp del QR siempre queda en el futuro
                fecha_ingreso=date(2099, 12, 20),
                fecha_egreso=date(2099, 12, 22),
                cantidad_personas=2,
                monto_total=15000.0,
                titular="Titular QR",
                email="titular.qr@grupo8.com",
                estado_reserva=estado_reserva,
                estado_pago=estado_pago,
            )
            db.add(reserva)
            db.commit()
            creados["reservas"].append(reserva.id)
            return reserva.id
        finally:
            db.close()

    yield crear_usuario, crear_reserva

    db = SessionLocal()
    try:
        db.query(Pago).filter(Pago.reserva_id.in_(creados["reservas"])).delete(synchronize_session=False)
        db.query(Reserva).filter(Reserva.id.in_(creados["reservas"])).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(creados["usuarios"])).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _headers(usuario_id) -> dict:
    token = jwt.encode({"sub": str(usuario_id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _pagar(mp, reserva_id):
    """Simula el aviso de Mercado Pago de un pago aprobado para la reserva."""
    payment_id = str(random.randint(10**11, 10**12 - 1))
    mp.pagos[payment_id] = {
        "id": int(payment_id),
        "status": "approved",
        "status_detail": "accredited",
        "external_reference": str(reserva_id),
        "transaction_amount": 15000,
        "currency_id": "ARS",
        "payment_method_id": "visa",
    }
    response = client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": payment_id}})
    assert response.status_code == 200


def _jti_guardado(reserva_id):
    db = SessionLocal()
    try:
        return db.query(Reserva.jwt_jti).filter(Reserva.id == reserva_id).scalar()
    finally:
        db.close()


def _claims(token, claves_es256):
    _, publica_pem = claves_es256
    return jwt.decode(token, publica_pem, algorithms=["ES256"])


# ---------- Jti guardado al pagar ----------

def test_al_confirmar_el_pago_se_guarda_el_jti_del_qr_del_correo(mp, datos, espia_qr, claves_es256):
    crear_usuario, crear_reserva = datos
    reserva_id = crear_reserva(crear_usuario())

    _pagar(mp, reserva_id)

    assert len(espia_qr) == 1
    jti_correo = _claims(espia_qr[0]["jwt"], claves_es256)["jti"]
    assert _jti_guardado(reserva_id) == jti_correo


# ---------- Descarga ----------

def test_el_dueno_descarga_el_qr_con_el_mismo_jti_del_correo(mp, datos, espia_qr, claves_es256):
    crear_usuario, crear_reserva = datos
    dueno = crear_usuario()
    reserva_id = crear_reserva(dueno)
    _pagar(mp, reserva_id)

    response = client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.startswith(FIRMA_PNG)

    # El primer QR es el del correo y el segundo, el de la descarga
    assert len(espia_qr) == 2
    assert response.content == espia_qr[1]["png"]
    correo = _claims(espia_qr[0]["jwt"], claves_es256)
    descarga = _claims(espia_qr[1]["jwt"], claves_es256)
    assert descarga["jti"] == correo["jti"] == _jti_guardado(reserva_id)
    assert descarga["reserva_id"] == str(reserva_id)


def test_descargar_varias_veces_no_cambia_el_jti(mp, datos, espia_qr, claves_es256):
    crear_usuario, crear_reserva = datos
    dueno = crear_usuario()
    reserva_id = crear_reserva(dueno)
    _pagar(mp, reserva_id)

    client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))
    client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))

    jtis = {_claims(llamada["jwt"], claves_es256)["jti"] for llamada in espia_qr}
    assert jtis == {_jti_guardado(reserva_id)}


def test_reserva_pagada_sin_jti_genera_uno_la_primera_vez_y_lo_guarda(datos, espia_qr, claves_es256):
    # Reserva pagada antes de este cambio: no tiene jti guardado
    crear_usuario, crear_reserva = datos
    dueno = crear_usuario()
    reserva_id = crear_reserva(dueno, EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA)
    assert _jti_guardado(reserva_id) is None

    primera = client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))
    segunda = client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))

    assert primera.status_code == 200
    assert segunda.status_code == 200
    guardado = _jti_guardado(reserva_id)
    assert guardado is not None
    assert [_claims(llamada["jwt"], claves_es256)["jti"] for llamada in espia_qr] == [guardado, guardado]


# ---------- Permisos ----------

def test_otro_usuario_no_puede_descargar_el_qr(mp, datos):
    crear_usuario, crear_reserva = datos
    dueno = crear_usuario()
    otro = crear_usuario()
    reserva_id = crear_reserva(dueno)
    _pagar(mp, reserva_id)

    response = client.get(f"/reservas/{reserva_id}/qr", headers=_headers(otro))

    assert response.status_code == 404


def test_reserva_sin_pagar_no_tiene_qr(datos):
    crear_usuario, crear_reserva = datos
    dueno = crear_usuario()
    reserva_id = crear_reserva(dueno)

    response = client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))

    assert response.status_code == 403
    assert _jti_guardado(reserva_id) is None


def test_reserva_cancelada_no_tiene_qr(datos):
    crear_usuario, crear_reserva = datos
    dueno = crear_usuario()
    reserva_id = crear_reserva(dueno, EstadoPagoEnum.CANCELADO, EstadoReservaEnum.CANCELADA)

    response = client.get(f"/reservas/{reserva_id}/qr", headers=_headers(dueno))

    assert response.status_code == 403


def test_reserva_inexistente_devuelve_404(datos):
    crear_usuario, _ = datos

    response = client.get(f"/reservas/{uuid.uuid4()}/qr", headers=_headers(crear_usuario()))

    assert response.status_code == 404


def test_sin_sesion_devuelve_401(datos):
    crear_usuario, crear_reserva = datos
    reserva_id = crear_reserva(crear_usuario(), EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA)

    response = client.get(f"/reservas/{reserva_id}/qr")

    assert response.status_code == 401
