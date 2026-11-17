"""Estado del pago al volver de Mercado Pago: GET /api/payments/estado/{reserva_id}, sin sesión."""
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import SessionLocal
from main import app
from models.pago import Pago
from models.reserva import (
    CondicionPersonaEnum,
    EstadoPagoEnum,
    EstadoReservaEnum,
    Reserva,
    ReservaPersona,
)
from services.payment_service import payment_service
from tests.test_confirmacion_pago import EmailServiceFalso, MercadoPagoFalso, SecurityServiceFalso

client = TestClient(app)

pytestmark = pytest.mark.usefixtures("camping_de_prueba")


class MercadoPagoConPagosInexistentes(MercadoPagoFalso):
    """Como el SDK real: un pago que no existe responde 404 en lugar de fallar."""

    def get(self, payment_id):
        if str(payment_id) not in self.pagos:
            return {"status": 404, "response": {"message": "Payment not found"}}
        return super().get(payment_id)


class MercadoPagoCaido(MercadoPagoFalso):
    def get(self, payment_id):
        raise ConnectionError("sin conexión")


@pytest.fixture
def correo(monkeypatch):
    SecurityServiceFalso.payloads = []
    falso = EmailServiceFalso()
    monkeypatch.setattr("services.payment_service.SecurityService", SecurityServiceFalso)
    monkeypatch.setattr("services.payment_service.email_service", falso)
    return falso


@pytest.fixture
def mp(monkeypatch):
    falso = MercadoPagoConPagosInexistentes()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


@pytest.fixture
def crear_reserva():
    """Reserva pendiente de un visitante (sin cuenta); se borra con sus pagos al terminar."""
    creadas = []

    def _crear(personas=2):
        db = SessionLocal()
        try:
            reserva = Reserva(
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=date(2099, 12, 20),
                fecha_egreso=date(2099, 12, 22),
                cantidad_personas=personas,
                monto_total=15000.0,
                titular="Titular Retorno",
                email="titular.retorno@grupo8.com",
                estado_reserva=EstadoReservaEnum.PENDIENTE,
                estado_pago=EstadoPagoEnum.PENDIENTE,
            )
            reserva.personas = [
                ReservaPersona(
                    orden=orden,
                    nombre=f"Persona {orden}",
                    edad=30,
                    condicion=CondicionPersonaEnum.visitante,
                    precio_base=7500,
                    descuento_pct=0,
                    precio_final=7500,
                )
                for orden in range(personas)
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


def _pago(mp, reserva_id, estado="approved", monto=15000):
    """Carga un pago en el Mercado Pago falso y devuelve su id."""
    payment_id = str(random.randint(10**11, 10**12 - 1))
    mp.pagos[payment_id] = {
        "id": int(payment_id),
        "status": estado,
        "status_detail": "accredited" if estado == "approved" else estado,
        "external_reference": str(reserva_id),
        "transaction_amount": monto,
        "currency_id": "ARS",
        "payment_method_id": "visa",
    }
    return payment_id


def _consultar(reserva_id, payment_id):
    return client.get(f"/api/payments/estado/{reserva_id}", params={"payment_id": payment_id})


def _reserva(reserva_id):
    db = SessionLocal()
    try:
        return db.get(Reserva, reserva_id)
    finally:
        db.close()


def _pagos_registrados(payment_id):
    db = SessionLocal()
    try:
        return db.query(Pago).filter(Pago.mp_payment_id == payment_id).all()
    finally:
        db.close()


# ---------- Pago aprobado ----------

def test_pago_aprobado_confirma_la_reserva_y_manda_un_correo(mp, correo, crear_reserva):
    reserva_id = crear_reserva(personas=3)
    payment_id = _pago(mp, reserva_id)

    response = _consultar(reserva_id, payment_id)

    assert response.status_code == 200
    cuerpo = response.json()
    assert cuerpo["estado"] == "confirmada"
    assert cuerpo["reserva"] == {
        "id": str(reserva_id),
        "codigo": f"#{str(reserva_id)[:8]}",
        "fecha_ingreso": "2099-12-20",
        "fecha_egreso": "2099-12-22",
        "cantidad_personas": 3,
    }
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PAGADO
    assert len(correo.enviados) == 1
    pagos = _pagos_registrados(payment_id)
    assert len(pagos) == 1 and pagos[0].estado == "approved" and pagos[0].reserva_id == reserva_id


def test_la_respuesta_no_tiene_datos_personales(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    texto = _consultar(reserva_id, _pago(mp, reserva_id)).text

    assert "Titular Retorno" not in texto
    assert "titular.retorno@grupo8.com" not in texto
    assert "Persona 0" not in texto


def test_consultar_dos_veces_no_confirma_ni_manda_el_correo_dos_veces(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id)

    primera = _consultar(reserva_id, payment_id)
    segunda = _consultar(reserva_id, payment_id)

    assert primera.json()["estado"] == segunda.json()["estado"] == "confirmada"
    assert len(correo.enviados) == 1
    assert len(_pagos_registrados(payment_id)) == 1


def test_si_el_webhook_ya_la_confirmo_no_manda_otro_correo(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id)
    client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": payment_id}})
    assert len(correo.enviados) == 1

    response = _consultar(reserva_id, payment_id)

    assert response.json()["estado"] == "confirmada"
    assert len(correo.enviados) == 1


# ---------- Datos que no coinciden ----------

def test_pago_aprobado_de_otra_reserva_no_sirve(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    otra = crear_reserva()
    pago_de_otra = _pago(mp, otra)

    response = _consultar(reserva_id, pago_de_otra)

    assert response.status_code == 404
    assert response.json()["detail"] == "No encontramos un pago de Mercado Pago para esta reserva."
    # No confirma ninguna de las dos
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE
    assert _reserva(otra).estado_pago == EstadoPagoEnum.PENDIENTE
    assert correo.enviados == []


def test_payment_id_inexistente(mp, correo, crear_reserva):
    reserva_id = crear_reserva()

    response = _consultar(reserva_id, "999999999999")

    assert response.status_code == 404
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE


def test_reserva_inexistente(mp, correo, crear_reserva):
    payment_id = _pago(mp, crear_reserva())

    response = _consultar(uuid.uuid4(), payment_id)

    assert response.status_code == 404


def test_sin_payment_id(mp, crear_reserva):
    response = client.get(f"/api/payments/estado/{crear_reserva()}")

    assert response.status_code == 422


# ---------- Pagos no aprobados ----------

def test_pago_rechazado_no_confirma(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id, estado="rejected")

    response = _consultar(reserva_id, payment_id)

    assert response.status_code == 200
    assert response.json()["estado"] == "rechazado"
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE
    assert correo.enviados == []
    # El intento queda registrado, como en el webhook
    assert _pagos_registrados(payment_id)[0].estado == "rejected"


@pytest.mark.parametrize("estado_mp", ["pending", "in_process"])
def test_pago_pendiente_queda_en_proceso(mp, correo, crear_reserva, estado_mp):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id, estado=estado_mp)

    response = _consultar(reserva_id, payment_id)

    assert response.json()["estado"] == "en_proceso"
    assert response.json()["mensaje"] == "Estamos confirmando tu pago."
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE
    assert correo.enviados == []


def test_pendiente_que_despues_se_aprueba_se_confirma_en_la_siguiente_consulta(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id, estado="in_process")
    assert _consultar(reserva_id, payment_id).json()["estado"] == "en_proceso"

    mp.pagos[payment_id]["status"] = "approved"

    assert _consultar(reserva_id, payment_id).json()["estado"] == "confirmada"
    assert len(correo.enviados) == 1


def test_importe_distinto_queda_en_revision(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id, monto=100)

    response = _consultar(reserva_id, payment_id)

    assert response.json()["estado"] == "revision"
    assert _reserva(reserva_id).estado_pago == EstadoPagoEnum.PENDIENTE
    assert correo.enviados == []


def test_reserva_cancelada_no_se_muestra_como_confirmada(mp, correo, crear_reserva):
    reserva_id = crear_reserva()
    payment_id = _pago(mp, reserva_id, estado="rejected")
    db = SessionLocal()
    try:
        reserva = db.get(Reserva, reserva_id)
        reserva.estado_reserva = EstadoReservaEnum.CANCELADA
        reserva.estado_pago = EstadoPagoEnum.CANCELADO
        # Vencida hace rato, para que un pago aprobado tampoco la reviva
        reserva.fecha_reserva = datetime.now(timezone.utc) - timedelta(days=1)
        db.commit()
    finally:
        db.close()

    response = _consultar(reserva_id, payment_id)

    assert response.json()["estado"] == "cancelada"


def test_si_mercado_pago_no_responde_devuelve_503(monkeypatch, crear_reserva):
    monkeypatch.setattr(payment_service, "mp", MercadoPagoCaido())

    response = _consultar(crear_reserva(), "123456789012")

    assert response.status_code == 503
