"""Registro de pagos de Mercado Pago en la tabla pagos (Issue 17.1)."""
import json
import random
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.pago import Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from services.payment_service import limpiar_respuesta_mp, payment_service, registrar_pago

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

# Datos del pagador que nunca deben llegar a la base
EMAIL_PAGADOR = "pagador.privado@correo.com"
DNI_PAGADOR = "30111222"
TELEFONO_PAGADOR = "2615551234"
ULTIMOS_DIGITOS = "4242"
TITULAR_TARJETA = "APRO PAGADOR"


# ---------- Dobles de prueba ----------

class MercadoPagoFalso:
    """Devuelve los pagos que se le cargan, como lo hace el SDK de Mercado Pago."""

    def __init__(self):
        self.pagos = {}

    def payment(self):
        return self

    def get(self, payment_id):
        return {"status": 200, "response": self.pagos[str(payment_id)]}

    def search(self, filtros):
        resultados = [
            pago for pago in self.pagos.values()
            if pago.get("external_reference") == filtros.get("external_reference")
        ]
        return {"response": {"results": resultados}}


class SecurityServiceFalso:
    def generate_offline_qr_token(self, payload):
        return "jwt-de-prueba"


class EmailServiceFalso:
    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):
        pass


def respuesta_mp(payment_id, reserva_id, estado="approved", detalle="accredited", monto=15000):
    """Respuesta completa de Mercado Pago, con los datos del pagador y de la tarjeta."""
    return {
        "id": int(payment_id),
        "status": estado,
        "status_detail": detalle,
        "external_reference": str(reserva_id),
        "transaction_amount": monto,
        "currency_id": "ARS",
        "payment_method_id": "visa",
        "payment_type_id": "credit_card",
        "installments": 1,
        "date_created": "2026-11-04T20:10:00.000-04:00",
        "date_approved": "2026-11-04T20:10:05.000-04:00" if estado == "approved" else None,
        "transaction_details": {
            "total_paid_amount": monto,
            "net_received_amount": monto - 500,
            "installment_amount": monto,
            "financial_institution": None,
        },
        "payer": {
            "email": EMAIL_PAGADOR,
            "identification": {"type": "DNI", "number": DNI_PAGADOR},
            "phone": {"area_code": "261", "number": TELEFONO_PAGADOR},
            "first_name": "Apro",
            "last_name": "Pagador",
        },
        "card": {
            "first_six_digits": "450995",
            "last_four_digits": ULTIMOS_DIGITOS,
            "expiration_month": 11,
            "expiration_year": 2030,
            "cardholder": {
                "name": TITULAR_TARJETA,
                "identification": {"type": "DNI", "number": DNI_PAGADOR},
            },
        },
        "additional_info": {
            "ip_address": "200.1.2.3",
            "payer": {"first_name": "Apro", "phone": {"number": TELEFONO_PAGADOR}},
        },
        "point_of_interaction": {"transaction_data": {"bank_info": {"payer": {"email": EMAIL_PAGADOR}}}},
    }


# ---------- Fixtures y helpers ----------

@pytest.fixture(autouse=True)
def servicios_falsos(monkeypatch):
    """QR y correo nunca son reales en estos tests."""
    monkeypatch.setattr("services.payment_service.SecurityService", SecurityServiceFalso)
    monkeypatch.setattr("services.payment_service.email_service", EmailServiceFalso())


@pytest.fixture
def mp(monkeypatch):
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


@pytest.fixture
def nuevo_payment_id():
    """Ids de pago propios de cada test; se borran al terminar."""
    usados = []

    def _nuevo():
        payment_id = str(random.randint(10**11, 10**12 - 1))
        usados.append(payment_id)
        return payment_id

    yield _nuevo

    db = SessionLocal()
    try:
        db.query(Pago).filter(Pago.mp_payment_id.in_(usados)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def crear_reserva():
    """Crea una reserva pendiente y la borra al terminar el test."""
    creadas = []

    def _crear():
        db = SessionLocal()
        try:
            reserva = Reserva(
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=date(2099, 12, 20),
                fecha_egreso=date(2099, 12, 22),
                cantidad_personas=3,
                monto_total=15000.0,
                titular="Titular Pago",
                email="titular.pago@grupo8.com",
                estado_reserva=EstadoReservaEnum.PENDIENTE,
                estado_pago=EstadoPagoEnum.PENDIENTE,
            )
            db.add(reserva)
            db.commit()
            creadas.append(reserva.id)
            return reserva.id
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id.in_(creadas)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _webhook(payment_id):
    return client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": payment_id}})


def _pagos(mp_payment_id):
    """Lee los pagos con una sesión nueva (distinta a la del endpoint)."""
    db = SessionLocal()
    try:
        return db.query(Pago).filter(Pago.mp_payment_id == mp_payment_id).all()
    finally:
        db.close()


def _estado_pago(reserva_id):
    db = SessionLocal()
    try:
        return db.query(Reserva.estado_pago).filter(Reserva.id == reserva_id).scalar()
    finally:
        db.close()


# ---------- Webhook ----------

def test_pago_aprobado_queda_registrado(mp, crear_reserva, nuevo_payment_id):
    reserva_id = crear_reserva()
    payment_id = nuevo_payment_id()
    mp.pagos[payment_id] = respuesta_mp(payment_id, reserva_id)

    response = _webhook(payment_id)

    assert response.status_code == 200
    pagos = _pagos(payment_id)
    assert len(pagos) == 1
    pago = pagos[0]
    assert pago.reserva_id == reserva_id
    assert pago.estado == "approved"
    assert pago.estado_detalle == "accredited"
    assert pago.monto == Decimal("15000.00")
    assert pago.moneda == "ARS"
    assert pago.metodo_pago == "visa"
    # Las fechas de Mercado Pago (UTC-4) se guardan en UTC
    assert pago.fecha_creacion == datetime(2026, 11, 5, 0, 10, 0, tzinfo=timezone.utc)
    assert pago.fecha_aprobacion == datetime(2026, 11, 5, 0, 10, 5, tzinfo=timezone.utc)
    assert pago.respuesta_mp["id"] == int(payment_id)
    # Registrar el pago no cambia lo que ya hacía el webhook
    assert _estado_pago(reserva_id) == EstadoPagoEnum.PAGADO


def test_pago_repetido_actualiza_el_registro_existente(mp, crear_reserva, nuevo_payment_id):
    reserva_id = crear_reserva()
    payment_id = nuevo_payment_id()

    # Primero llega en revisión y después aprobado: es el mismo pago
    mp.pagos[payment_id] = respuesta_mp(payment_id, reserva_id, estado="in_process", detalle="pending_contingency")
    _webhook(payment_id)
    mp.pagos[payment_id] = respuesta_mp(payment_id, reserva_id)
    _webhook(payment_id)
    # Mercado Pago puede repetir el mismo aviso
    _webhook(payment_id)

    pagos = _pagos(payment_id)
    assert len(pagos) == 1
    assert pagos[0].estado == "approved"
    assert pagos[0].estado_detalle == "accredited"
    assert pagos[0].fecha_aprobacion is not None


def test_pago_rechazado_queda_registrado_sin_confirmar_la_reserva(mp, crear_reserva, nuevo_payment_id):
    reserva_id = crear_reserva()
    payment_id = nuevo_payment_id()
    mp.pagos[payment_id] = respuesta_mp(
        payment_id, reserva_id, estado="rejected", detalle="cc_rejected_insufficient_amount"
    )

    response = _webhook(payment_id)

    assert response.status_code == 200
    pagos = _pagos(payment_id)
    assert len(pagos) == 1
    assert pagos[0].reserva_id == reserva_id
    assert pagos[0].estado == "rejected"
    assert pagos[0].estado_detalle == "cc_rejected_insufficient_amount"
    assert pagos[0].fecha_aprobacion is None
    assert _estado_pago(reserva_id) == EstadoPagoEnum.PENDIENTE


def test_respuesta_mp_se_guarda_sin_datos_sensibles(mp, crear_reserva, nuevo_payment_id):
    reserva_id = crear_reserva()
    payment_id = nuevo_payment_id()
    mp.pagos[payment_id] = respuesta_mp(payment_id, reserva_id)

    _webhook(payment_id)

    guardada = _pagos(payment_id)[0].respuesta_mp
    for campo in ("payer", "card", "additional_info", "point_of_interaction"):
        assert campo not in guardada
    texto = json.dumps(guardada)
    for dato in (EMAIL_PAGADOR, DNI_PAGADOR, TELEFONO_PAGADOR, ULTIMOS_DIGITOS, TITULAR_TARJETA, "200.1.2.3"):
        assert dato not in texto
    # Los datos del pago sí se conservan
    assert guardada["status"] == "approved"
    assert guardada["transaction_details"] == {
        "total_paid_amount": 15000,
        "net_received_amount": 14500,
        "installment_amount": 15000,
    }


# ---------- Reconciliación ----------

def test_reconciliacion_registra_todos_los_intentos(mp, crear_reserva, nuevo_payment_id, como_admin):
    reserva_id = crear_reserva()
    rechazado, aprobado = nuevo_payment_id(), nuevo_payment_id()
    mp.pagos[rechazado] = respuesta_mp(rechazado, reserva_id, estado="rejected", detalle="cc_rejected_other_reason")
    mp.pagos[aprobado] = respuesta_mp(aprobado, reserva_id)

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "reconciliado"
    assert _pagos(rechazado)[0].estado == "rejected"
    assert _pagos(aprobado)[0].estado == "approved"
    assert _estado_pago(reserva_id) == EstadoPagoEnum.PAGADO


def test_webhook_y_reconciliacion_del_mismo_pago_dejan_un_solo_registro(mp, crear_reserva, nuevo_payment_id, como_admin):
    reserva_id = crear_reserva()
    payment_id = nuevo_payment_id()
    # El webhook lo informa pendiente y la reconciliación ya aprobado
    mp.pagos[payment_id] = respuesta_mp(payment_id, reserva_id, estado="pending", detalle="pending_waiting_payment")
    _webhook(payment_id)
    mp.pagos[payment_id] = respuesta_mp(payment_id, reserva_id)
    client.get(f"/api/payments/reconcile/{reserva_id}")

    pagos = _pagos(payment_id)
    assert len(pagos) == 1
    assert pagos[0].estado == "approved"


# ---------- Servicio ----------

def test_pago_de_una_reserva_inexistente_se_registra_sin_reserva(nuevo_payment_id):
    payment_id = nuevo_payment_id()
    db = SessionLocal()
    try:
        pago = registrar_pago(db, respuesta_mp(payment_id, uuid.uuid4()))
        db.commit()
        assert pago.reserva_id is None
        assert pago.estado == "approved"
    finally:
        db.close()


def test_respuesta_sin_id_no_se_registra():
    db = SessionLocal()
    try:
        assert registrar_pago(db, {"status": "approved"}) is None
    finally:
        db.close()


def test_limpiar_respuesta_descarta_campos_desconocidos():
    limpia = limpiar_respuesta_mp({"id": 1, "status": "approved", "campo_nuevo": "x", "payer": {"email": "a@b.c"}})
    assert limpia == {"id": 1, "status": "approved"}
