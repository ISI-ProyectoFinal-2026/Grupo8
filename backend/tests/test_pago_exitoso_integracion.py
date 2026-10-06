import uuid
from datetime import date, timedelta
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

import api.payments as payments_module
from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import User

# Las reservas necesitan el camping cargado (FK)
pytestmark = [pytest.mark.anyio, pytest.mark.usefixtures("camping_de_prueba")]

Base.metadata.create_all(bind=engine)

WEBHOOK_URL = "/api/payments/webhook"
PAYMENT_ID = "123456789"


# ---------- Helpers ----------

def _respuesta_mp(reserva_id: uuid.UUID, estado: str = "approved") -> dict:
    """Forma mínima de lo que devuelve mercadopago.SDK().payment().get()."""
    return {
        "status": 200,
        "response": {
            "id": PAYMENT_ID,
            "status": estado,
            "external_reference": str(reserva_id),
        },
    }


def _obtener_estado(reserva_id: uuid.UUID) -> EstadoPagoEnum:
    """Lee el estado con una sesión NUEVA (distinta a la del endpoint)."""
    db = SessionLocal()
    try:
        return db.query(Reserva.estado_pago).filter(Reserva.id == reserva_id).scalar()
    finally:
        db.close()


def _obtener_estado_reserva(reserva_id: uuid.UUID) -> EstadoReservaEnum:
    """Igual que _obtener_estado, pero para el estado operativo de la reserva."""
    db = SessionLocal()
    try:
        return db.query(Reserva.estado_reserva).filter(Reserva.id == reserva_id).scalar()
    finally:
        db.close()


async def _enviar_webhook(payment_id: str = PAYMENT_ID):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post(
            WEBHOOK_URL,
            json={
                "action": "payment.updated",
                "type": "payment",
                "data": {"id": payment_id},
            },
        )


# ---------- Fixtures ----------

@pytest.fixture
def crear_reserva():
    """Factory: crea usuario + reserva reales y los borra al terminar el test.

    La limpieza es necesaria: crear_reserva() ocupa cupo y
    test_integracion_reservas valida capacidad contra la misma BD.
    """
    creados: list[tuple[uuid.UUID, uuid.UUID]] = []

    def _crear(estado: EstadoPagoEnum = EstadoPagoEnum.PENDIENTE) -> uuid.UUID:
        db = SessionLocal()
        try:
            usuario = User(
                email=f"pago_test_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre="Usuario Pago Test",
                dni=f"T{uuid.uuid4().hex[:10]}",
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)

            manana = date.today() + timedelta(days=1)
            reserva = Reserva(
                user_id=usuario.id,
                camping_id=settings.CAMPING_ID,
                fecha_ingreso=manana,
                fecha_egreso=manana,
                cantidad_personas=2,
                monto_total=10000.0,
                titular=usuario.nombre,
                email=usuario.email,
                estado_reserva=EstadoReservaEnum.PENDIENTE,
                estado_pago=estado,
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


@pytest.fixture
def mp_mock(monkeypatch):
    """Reemplaza el SDK de Mercado Pago (sin red) y el servicio de email."""
    mp = MagicMock()
    monkeypatch.setattr(payments_module.payment_service, "mp", mp)
    # Defensivo: si más adelante se corrige el bloque de email del webhook,
    # estos tests no deben intentar enviar correos reales.
    monkeypatch.setattr(payments_module, "email_service", MagicMock())
    # Tampoco dependemos de las claves JWT: el webhook genera el QR con SecurityService
    monkeypatch.setattr(payments_module, "SecurityService", MagicMock())
    return mp


# ---------- Tests ----------

async def test_webhook_pago_aprobado_actualiza_reserva_a_pagado(crear_reserva, mp_mock):
    reserva_id = crear_reserva()
    mp_mock.payment.return_value.get.return_value = _respuesta_mp(reserva_id)

    # Precondición: parte de PENDIENTE
    assert _obtener_estado(reserva_id) == EstadoPagoEnum.PENDIENTE
    assert _obtener_estado_reserva(reserva_id) == EstadoReservaEnum.PENDIENTE

    response = await _enviar_webhook()

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    # El webhook consultó a MP con el id de la notificación (seguridad)
    mp_mock.payment.return_value.get.assert_called_once_with(PAYMENT_ID)
    # Persistido en PostgreSQL (el enum guarda el nombre PAGADO)
    assert _obtener_estado(reserva_id) == EstadoPagoEnum.PAGADO
    # Y la reserva queda confirmada, que es el estado operativo
    assert _obtener_estado_reserva(reserva_id) == EstadoReservaEnum.CONFIRMADA


async def test_webhook_pago_aprobado_no_modifica_otras_reservas(crear_reserva, mp_mock):
    reserva_pagada = crear_reserva()
    reserva_ajena = crear_reserva()
    mp_mock.payment.return_value.get.return_value = _respuesta_mp(reserva_pagada)

    response = await _enviar_webhook()

    assert response.status_code == 200
    assert _obtener_estado(reserva_pagada) == EstadoPagoEnum.PAGADO
    # Se vincula únicamente por external_reference
    assert _obtener_estado(reserva_ajena) == EstadoPagoEnum.PENDIENTE
    assert _obtener_estado_reserva(reserva_ajena) == EstadoReservaEnum.PENDIENTE