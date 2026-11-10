"""Confirmación del pago y envío del QR desde el webhook y la reconciliación (Issue 17.2)."""
import random
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.pago import Pago
from models.reserva import (
    CondicionPersonaEnum,
    EstadoPagoEnum,
    EstadoReservaEnum,
    Reserva,
    ReservaPersona,
)
from services.payment_service import payment_service, tipo_qr

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")


# ---------- Dobles de prueba ----------

class MercadoPagoFalso:
    """Devuelve los pagos cargados, como el SDK de Mercado Pago."""

    def __init__(self):
        self.pagos = {}

    def payment(self):
        return self

    def get(self, payment_id):
        return {"status": 200, "response": self.pagos[str(payment_id)]}

    def search(self, filtros):
        resultados = [
            pago for pago in self.pagos.values()
            if pago["external_reference"] == filtros.get("external_reference")
        ]
        return {"response": {"results": resultados}}


class SecurityServiceFalso:
    payloads = []

    def generate_offline_qr_token(self, payload):
        SecurityServiceFalso.payloads.append(payload)
        return f"jwt-{len(SecurityServiceFalso.payloads)}"


class EmailServiceFalso:
    def __init__(self):
        self.enviados = []

    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):
        self.enviados.append({"destinatario": destinatario, "reserva_id": datos_reserva["reserva_id"]})


# ---------- Fixtures y helpers ----------

@pytest.fixture
def correo(monkeypatch):
    """QR y correo falsos; devuelve el servicio de correo para ver qué se envió."""
    SecurityServiceFalso.payloads = []
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
def crear_reserva():
    """Crea una reserva pendiente con sus personas y la borra (junto con sus pagos) al terminar."""
    creadas = []

    def _crear(condiciones=("visitante",)):
        db = SessionLocal()
        try:
            reserva = Reserva(
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=date(2099, 12, 20),
                fecha_egreso=date(2099, 12, 22),
                cantidad_personas=len(condiciones) or 1,
                monto_total=15000.0,
                titular="Titular Confirmación",
                email="titular.confirmacion@grupo8.com",
                estado_reserva=EstadoReservaEnum.PENDIENTE,
                estado_pago=EstadoPagoEnum.PENDIENTE,
            )
            reserva.personas = [
                ReservaPersona(
                    orden=orden,
                    nombre=f"Persona {orden}",
                    edad=30,
                    condicion=CondicionPersonaEnum(condicion),
                    dni=f"P{uuid.uuid4().hex[:10]}" if condicion == "socio" else None,
                    precio_base=5000,
                    descuento_pct=0,
                    precio_final=5000,
                )
                for orden, condicion in enumerate(condiciones)
            ]
            db.add(reserva)
            db.commit()
            creadas.append(reserva.id)
            return reserva.id
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        db.query(Pago).filter(Pago.reserva_id.in_(creadas)).delete(synchronize_session=False)
        db.query(Reserva).filter(Reserva.id.in_(creadas)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _pago_aprobado(mp, reserva_id):
    """Carga en el Mercado Pago falso un pago aprobado para la reserva y devuelve su id."""
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
    return payment_id


def _webhook(payment_id):
    return client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": payment_id}})


def _reconciliar(reserva_id):
    return client.get(f"/api/payments/reconcile/{reserva_id}")


def _estado_pago(reserva_id):
    db = SessionLocal()
    try:
        return db.query(Reserva.estado_pago).filter(Reserva.id == reserva_id).scalar()
    finally:
        db.close()


# ---------- Envío del correo ----------

def test_webhook_confirma_la_reserva_y_envia_el_correo_con_el_qr(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago_aprobado(mp, reserva_id)

    response = _webhook(payment_id)

    assert response.status_code == 200
    assert _estado_pago(reserva_id) == EstadoPagoEnum.PAGADO
    assert correo.enviados == [
        {"destinatario": "titular.confirmacion@grupo8.com", "reserva_id": str(reserva_id)}
    ]


def test_reconciliacion_confirma_la_reserva_y_envia_el_correo_con_el_qr(mp, correo, crear_reserva, como_admin):
    reserva_id = crear_reserva()
    _pago_aprobado(mp, reserva_id)

    response = _reconciliar(reserva_id)

    assert response.status_code == 200
    assert response.json()["status"] == "reconciliado"
    assert _estado_pago(reserva_id) == EstadoPagoEnum.PAGADO
    assert correo.enviados == [
        {"destinatario": "titular.confirmacion@grupo8.com", "reserva_id": str(reserva_id)}
    ]
    assert SecurityServiceFalso.payloads[0].reserva_id == str(reserva_id)


# ---------- Una sola vez ----------

def test_aviso_repetido_no_reenvia_el_correo(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago_aprobado(mp, reserva_id)

    _webhook(payment_id)
    _webhook(payment_id)
    _webhook(payment_id)

    assert len(correo.enviados) == 1
    assert len(SecurityServiceFalso.payloads) == 1


def test_reconciliacion_repetida_no_reenvia_el_correo(mp, correo, crear_reserva, como_admin):
    reserva_id = crear_reserva()
    _pago_aprobado(mp, reserva_id)

    primera = _reconciliar(reserva_id)
    segunda = _reconciliar(reserva_id)

    assert primera.json()["status"] == "reconciliado"
    # La segunda ve la reserva ya pagada y no vuelve a confirmarla
    assert segunda.json()["status"] == "ok"
    assert len(correo.enviados) == 1


def test_reconciliacion_despues_del_webhook_no_reenvia_el_correo(mp, correo, crear_reserva, como_admin):
    reserva_id = crear_reserva()
    payment_id = _pago_aprobado(mp, reserva_id)

    _webhook(payment_id)
    _reconciliar(reserva_id)

    assert len(correo.enviados) == 1


# ---------- Tipo del QR ----------

@pytest.mark.parametrize(
    "condiciones, tipo",
    [
        (("socio",), "socio"),
        (("socio", "socio", "socio"), "socio"),
        (("socio", "visitante"), "visitante"),
        (("visitante", "socio"), "visitante"),
        (("visitante", "visitante"), "visitante"),
    ],
)
def test_el_tipo_del_qr_sale_de_las_personas_de_la_reserva(mp, correo, crear_reserva, condiciones, tipo):
    reserva_id = crear_reserva(condiciones)
    _webhook(_pago_aprobado(mp, reserva_id))

    assert [payload.typ for payload in SecurityServiceFalso.payloads] == [tipo]


def test_reserva_sin_personas_cargadas_sale_como_visitante():
    # Reservas anteriores a la carga de personas
    assert tipo_qr(Reserva(personas=[])) == "visitante"
