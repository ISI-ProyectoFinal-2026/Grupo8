"""
Flujo real: POST /api/payments/webhook -> actualización de la reserva en la BD
-> BackgroundTasks -> EmailService real (plantilla + QR reales) -> resend.Emails.send,
que está interceptado por la fixture `resend_falso` (tests/conftest.py).

Se reemplazan solo: Mercado Pago (fake) y SecurityService (por uno con una clave
ES256 efímera generada en el test, para no depender de JWT_PRIVATE_KEY del .env).
"""
import io
import logging
import uuid
from datetime import date

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from PIL import Image

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import User
from security.services import SecurityService
from services.payment_service import payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

PAGADA = (EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA)
FIRMA_PNG = b"\x89PNG\r\n\x1a\n"
EMAIL_TITULAR = "titular@real.com"


# ---------- Dobles y fixtures ----------

class MercadoPagoFalso:
    def __init__(self, reserva_id, estado_pago="approved"):
        self.reserva_id = reserva_id
        self.estado_pago = estado_pago
        self.llamadas = []

    def payment(self):
        return self

    def get(self, payment_id):
        self.llamadas.append(payment_id)
        return {
            "status": 200,
            "response": {
                "id": payment_id,
                "status": self.estado_pago,
                "external_reference": self.reserva_id,
            },
        }


@pytest.fixture(scope="module")
def claves_es256():
    """Par de claves efímero, generado en memoria (nada hardcodeado)."""
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
    # El webhook instancia SecurityService() sin argumentos; se le inyecta la clave de prueba
    monkeypatch.setattr(
        "api.payments.SecurityService", lambda: SecurityService(private_key=privada_pem)
    )


@pytest.fixture
def instalar_mp(monkeypatch):
    def _instalar(reserva_id, estado_pago="approved"):
        mp = MercadoPagoFalso(str(reserva_id), estado_pago)
        monkeypatch.setattr(payment_service, "mp", mp)
        return mp

    return _instalar


@pytest.fixture
def crear_reserva():
    """Factory: crea usuario + reserva PENDIENTE y los borra al terminar el test."""
    creados = []

    def _crear(es_socio=False):
        db = SessionLocal()
        try:
            usuario = User(
                email=f"usuario_{uuid.uuid4()}@grupo8.com",  # distinto al del titular
                password_hash="secreto",
                nombre="Usuario Logueado",
                dni=f"E{uuid.uuid4().hex[:10]}",
                is_socio=es_socio,
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)

            reserva = Reserva(
                user_id=usuario.id,
                camping_id=settings.CAMPING_ID,
                # Fechas lejanas: el exp del QR siempre queda en el futuro
                fecha_ingreso=date(2099, 12, 20),
                fecha_egreso=date(2099, 12, 22),
                cantidad_personas=3,
                monto_total=15000.0,
                titular="Titular Real",
                email=EMAIL_TITULAR,
                telefono="2604123456",
                estado_reserva=EstadoReservaEnum.PENDIENTE,
                estado_pago=EstadoPagoEnum.PENDIENTE,
            )
            db.add(reserva)
            db.commit()
            db.refresh(reserva)
            creados.append((reserva.id, usuario.id))
            return reserva.id
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        for reserva_id, usuario_id in creados:
            db.query(Reserva).filter(Reserva.id == reserva_id).delete()
            db.query(User).filter(User.id == usuario_id).delete()
        db.commit()
    finally:
        db.close()


def _estados(reserva_id):
    """Lee los estados con una sesión nueva (distinta a la del endpoint)."""
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == reserva_id).first()
        return reserva.estado_pago, reserva.estado_reserva
    finally:
        db.close()


def _webhook(payment_id="123"):
    return client.post(
        "/api/payments/webhook",
        json={"type": "payment", "data": {"id": payment_id}},
    )


# ---------- Disparo del envío ----------

def test_pago_aprobado_dispara_el_envio_por_resend_con_la_reserva_ya_confirmada(
    resend_falso, instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id)
    estados_al_enviar = []
    # Dentro de send() se lee la BD: prueba que el envío ocurre DESPUÉS de confirmar el pago
    resend_falso.efecto = lambda params: estados_al_enviar.append(_estados(reserva_id))

    response = _webhook()

    assert response.status_code == 200
    assert len(resend_falso.enviados) == 1
    assert estados_al_enviar == [PAGADA]
    assert _estados(reserva_id) == PAGADA


def test_pago_rechazado_no_envia_correo_ni_genera_qr(
    resend_falso, espia_qr, instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id, estado_pago="rejected")

    response = _webhook()

    assert response.status_code == 200
    assert resend_falso.enviados == []
    assert espia_qr == []


def test_webhooks_aprobados_repetidos_envian_un_solo_correo(
    resend_falso, instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id)

    _webhook("123")
    _webhook("123")

    assert len(resend_falso.enviados) == 1


# ---------- Contenido del correo ----------

def test_el_correo_contiene_los_datos_de_la_reserva(resend_falso, instalar_mp, crear_reserva):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id)

    _webhook()

    params = resend_falso.enviados[0]
    # Destinatario y nombre salen del titular de la reserva, no del usuario logueado
    assert params["to"] == [EMAIL_TITULAR]
    assert "confirmada" in params["subject"].lower()
    html = params["html"]
    assert "Titular Real" in html
    assert "Usuario Logueado" not in html
    assert str(reserva_id) in html
    assert "2099-12-20" in html
    assert "3" in html.split("Cantidad de Personas:</strong>")[1][:20]
    assert 'src="cid:qr_code"' in html


def test_el_correo_adjunta_el_qr_como_png(resend_falso, espia_qr, instalar_mp, crear_reserva):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id)

    _webhook()

    adjuntos = resend_falso.enviados[0]["attachments"]
    assert len(adjuntos) == 1
    assert adjuntos[0]["filename"] == f"QR_Acceso_{reserva_id}.png"
    assert adjuntos[0]["content_id"] == "qr_code"

    png = bytes(adjuntos[0]["content"])
    assert png.startswith(FIRMA_PNG)
    imagen = Image.open(io.BytesIO(png))
    imagen.load()
    assert imagen.format == "PNG"
    assert imagen.width == imagen.height

    assert len(espia_qr) == 1
    assert png == espia_qr[0]["png"]


@pytest.mark.parametrize("es_socio, tipo", [(False, "visitante"), (True, "socio")])
def test_el_qr_adjunto_se_genera_con_un_jwt_firmado_con_los_datos_de_la_reserva(
    resend_falso, espia_qr, instalar_mp, crear_reserva, claves_es256, es_socio, tipo
):
    reserva_id = crear_reserva(es_socio=es_socio)
    instalar_mp(reserva_id)

    _webhook()

    assert len(espia_qr) == 1
    _, publica_pem = claves_es256
    claims = jwt.decode(espia_qr[0]["jwt"], publica_pem, algorithms=["ES256"])
    assert claims["reserva_id"] == str(reserva_id)
    assert claims["camping_id"] == settings.CAMPING_ID
    assert claims["cantidad_personas"] == 3
    assert claims["typ"] == tipo
    assert claims["dat"] == "2099-12-20"
    assert claims["exp"] > claims["iat"]
    uuid.UUID(claims["jti"])
    # El archivo adjunto es el PNG de ese mismo token
    assert bytes(resend_falso.enviados[0]["attachments"][0]["content"]) == espia_qr[0]["png"]


# ---------- Falla del proveedor ----------

def test_si_resend_falla_el_pago_igual_queda_confirmado(
    resend_falso, instalar_mp, crear_reserva, caplog
):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id)
    resend_falso.error = RuntimeError("Resend caído")

    with caplog.at_level(logging.ERROR, logger="services.email_service"):
        response = _webhook()

    assert response.status_code == 200
    assert len(resend_falso.enviados) == 1  
    assert _estados(reserva_id) == PAGADA
    assert "Error crítico en hilo secundario" in caplog.text
