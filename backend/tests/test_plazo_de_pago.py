"""Plazo de pago de las reservas pendientes y pagos que llegan tarde (Issue 17.5)."""
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.pago import Pago
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from services.capacity_service import CapacityService, plazo_vencido, vencimiento_pago
from services.payment_service import payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

PLAZO = 10
MONTO = 15000.0


def _ahora():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------- Dobles de prueba ----------

class MercadoPagoFalso:
    def __init__(self, reembolso_falla=False):
        self.pagos = {}
        self.preferencia = None
        self.reembolsos = []
        self.reembolso_falla = reembolso_falla

    def payment(self):
        return self

    def preference(self):
        return self

    def refund(self):
        return Reembolsos(self)

    def get(self, payment_id):
        return {"status": 200, "response": self.pagos[str(payment_id)]}

    def search(self, filtros):
        resultados = [
            pago for pago in self.pagos.values()
            if pago["external_reference"] == filtros.get("external_reference")
        ]
        return {"response": {"results": resultados}}

    def create(self, datos):
        self.preferencia = datos
        return {"status": 201, "response": {"sandbox_init_point": "https://mp.test/init"}}


class Reembolsos:
    def __init__(self, mp):
        self.mp = mp

    def create(self, payment_id, refund_object=None, request_options=None):
        self.mp.reembolsos.append(str(payment_id))
        if self.mp.reembolso_falla:
            return {"status": 500, "response": {"message": "internal_error"}}
        return {"status": 201, "response": {"id": 1, "payment_id": payment_id, "status": "approved"}}


class SecurityServiceFalso:
    def generate_offline_qr_token(self, payload):
        return "jwt-de-prueba"


class EmailServiceFalso:
    def __init__(self):
        self.confirmaciones = []
        self.cancelaciones = []

    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):
        self.confirmaciones.append(datos_reserva["reserva_id"])

    def enviar_cancelacion_sync(self, destinatario, datos_reserva):
        self.cancelaciones.append(datos_reserva)


# ---------- Fixtures y helpers ----------

@pytest.fixture(autouse=True)
def plazo_de_diez_minutos(monkeypatch):
    monkeypatch.setattr(settings, "RESERVA_PENDIENTE_TTL_MINUTES", PLAZO)


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
def fechas():
    """Fechas propias de cada test, para que el cupo no dependa de reservas de otros tests."""
    ingreso = date(2090 + random.randint(0, 9), random.randint(1, 12), random.randint(1, 20))
    return ingreso, ingreso + timedelta(days=2)


@pytest.fixture
def reservas():
    """Crea reservas con la antigüedad y el estado pedidos y las borra (con sus pagos) al terminar."""
    creadas = []

    def _crear(
        fechas,
        minutos=0,
        personas=3,
        estado_reserva=EstadoReservaEnum.PENDIENTE,
        estado_pago=EstadoPagoEnum.PENDIENTE,
        user_id=None,
    ):
        db = SessionLocal()
        try:
            reserva = Reserva(
                user_id=user_id,
                camping_id=settings.CAMPING_ID,
                fecha_reserva=_ahora() - timedelta(minutes=minutos),
                fecha_ingreso=fechas[0],
                fecha_egreso=fechas[1],
                cantidad_personas=personas,
                monto_total=MONTO,
                titular="Titular Plazo",
                email="titular.plazo@grupo8.com",
                estado_reserva=estado_reserva,
                estado_pago=estado_pago,
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
        db.query(Pago).filter(Pago.reserva_id.in_(creadas)).delete(synchronize_session=False)
        db.query(Reserva).filter(Reserva.id.in_(creadas)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def cupo_justo(configurar_camping):
    """Deja el camping con lugar para exactamente `lugares` personas (sin buffer offline)."""
    def _fijar(lugares):
        configurar_camping(capacidad_total=lugares, porcentaje_buffer_offline=0)
    return _fijar


def _reserva(reserva_id):
    db = SessionLocal()
    try:
        return db.query(Reserva).filter(Reserva.id == reserva_id).one()
    finally:
        db.close()


def _pago(mp_payment_id):
    db = SessionLocal()
    try:
        return db.query(Pago).filter(Pago.mp_payment_id == str(mp_payment_id)).one()
    finally:
        db.close()


def _pago_aprobado(mp, reserva_id):
    payment_id = str(random.randint(10**11, 10**12 - 1))
    mp.pagos[payment_id] = {
        "id": int(payment_id),
        "status": "approved",
        "status_detail": "accredited",
        "external_reference": str(reserva_id),
        "transaction_amount": MONTO,
        "currency_id": "ARS",
        "payment_method_id": "visa",
    }
    return payment_id


def _webhook(payment_id):
    return client.post("/api/payments/webhook", json={"type": "payment", "data": {"id": payment_id}})


# ---------- Vencimiento ----------

def test_vencimiento_es_la_fecha_de_la_reserva_mas_el_plazo():
    creada = datetime(2026, 11, 10, 17, 0, 0)

    assert vencimiento_pago(creada) == datetime(2026, 11, 10, 17, 10, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "minutos, estado, vencida",
    [
        (PLAZO - 1, EstadoReservaEnum.PENDIENTE, False),  # dentro del plazo
        (PLAZO + 1, EstadoReservaEnum.PENDIENTE, True),  # fuera del plazo
        (PLAZO + 1, EstadoReservaEnum.CONFIRMADA, False),  # pagada: el plazo ya no importa
        (0, EstadoReservaEnum.CANCELADA, True),
    ],
)
def test_plazo_vencido(minutos, estado, vencida):
    reserva = Reserva(fecha_reserva=_ahora() - timedelta(minutes=minutos), estado_reserva=estado)

    assert plazo_vencido(reserva) is vencida


def test_crear_reserva_devuelve_el_vencimiento_del_plazo(fechas):
    antes = datetime.now(timezone.utc)
    response = client.post(
        "/reservas/",
        json={
            "fecha_ingreso": fechas[0].isoformat(),
            "fecha_egreso": fechas[1].isoformat(),
            "personas": [{"nombre": "Titular Plazo", "edad": 30, "condicion": "visitante"}],
            "email": "titular.plazo@grupo8.com",
        },
    )

    assert response.status_code == 201
    reserva = response.json()
    vencimiento = datetime.fromisoformat(reserva["vencimiento_pago"])
    # Viaja con zona horaria, para que el navegador no lo lea como hora local
    assert vencimiento.tzinfo is not None
    assert antes + timedelta(minutes=PLAZO - 1) < vencimiento <= datetime.now(timezone.utc) + timedelta(minutes=PLAZO)

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == reserva["id"]).delete()
        db.commit()
    finally:
        db.close()


# ---------- Cancelación de las vencidas ----------

def test_se_cancelan_solo_las_pendientes_fuera_de_plazo(reservas, fechas):
    vencida = reservas(fechas, minutos=PLAZO + 1)
    en_plazo = reservas(fechas, minutos=PLAZO - 1)
    pagada = reservas(
        fechas, minutos=PLAZO + 60,
        estado_reserva=EstadoReservaEnum.CONFIRMADA, estado_pago=EstadoPagoEnum.PAGADO,
    )
    en_alerta = reservas(fechas, minutos=PLAZO + 60, estado_reserva=EstadoReservaEnum.ALERTA_CLONACION)

    db = SessionLocal()
    try:
        CapacityService().cancelar_reservas_vencidas(db)
    finally:
        db.close()

    assert (_reserva(vencida).estado_reserva, _reserva(vencida).estado_pago) == (
        EstadoReservaEnum.CANCELADA, EstadoPagoEnum.CANCELADO,
    )
    assert _reserva(en_plazo).estado_reserva == EstadoReservaEnum.PENDIENTE
    assert _reserva(pagada).estado_reserva == EstadoReservaEnum.CONFIRMADA
    assert _reserva(en_alerta).estado_reserva == EstadoReservaEnum.ALERTA_CLONACION


def test_crear_una_reserva_cancela_las_vencidas_y_usa_su_cupo(reservas, fechas, cupo_justo):
    cupo_justo(3)
    vencida = reservas(fechas, minutos=PLAZO + 1, personas=3)

    response = client.post(
        "/reservas/",
        json={
            "fecha_ingreso": fechas[0].isoformat(),
            "fecha_egreso": fechas[1].isoformat(),
            "personas": [
                {"nombre": nombre, "edad": 30, "condicion": "visitante"} for nombre in ("Ana", "Beto", "Caro")
            ],
            "email": "otra.persona@grupo8.com",
        },
    )

    assert response.status_code == 201
    assert _reserva(vencida).estado_reserva == EstadoReservaEnum.CANCELADA

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == response.json()["id"]).delete()
        db.commit()
    finally:
        db.close()


def test_una_reserva_dentro_del_plazo_sigue_ocupando_el_cupo(reservas, fechas, cupo_justo):
    cupo_justo(3)
    reservas(fechas, minutos=PLAZO - 1, personas=3)

    response = client.post(
        "/reservas/",
        json={
            "fecha_ingreso": fechas[0].isoformat(),
            "fecha_egreso": fechas[1].isoformat(),
            "personas": [{"nombre": "Persona", "edad": 30, "condicion": "visitante"}],
            "email": "otra.persona@grupo8.com",
        },
    )

    assert response.status_code == 400


def test_mis_reservas_cancela_las_vencidas(reservas, fechas):
    db = SessionLocal()
    try:
        sufijo = uuid.uuid4().hex[:10]
        usuario = User(
            email=f"plazo_{sufijo}@grupo8.com", password_hash="!", nombre="Plazo",
            dni=f"P{sufijo}", rol=RoleEnum.CLIENTE,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        db.expunge(usuario)
    finally:
        db.close()
    vencida = reservas(fechas, minutos=PLAZO + 1, user_id=usuario.id)
    app.dependency_overrides[get_current_user] = lambda: usuario
    try:
        response = client.get("/reservas/mias")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    mia = next(r for r in response.json() if r["id"] == str(vencida))
    assert mia["estado_reserva"] == EstadoReservaEnum.CANCELADA.value
    # Una reserva cancelada ya no tiene plazo para pagar
    assert mia["vencimiento_pago"] is None

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == vencida).delete()
        db.query(User).filter(User.id == usuario.id).delete()
        db.commit()
    finally:
        db.close()


# ---------- Preferencia de Mercado Pago ----------

def test_la_preferencia_vence_con_la_reserva_y_excluye_el_efectivo(mp, reservas, fechas):
    reserva_id = reservas(fechas, minutos=2)

    response = client.post("/api/payments/create", json={"title": "Reserva", "reserva_id": str(reserva_id)})

    assert response.status_code == 200
    preferencia = mp.preferencia
    assert preferencia["expires"] is True
    vencimiento = vencimiento_pago(_reserva(reserva_id).fecha_reserva)
    # Mercado Pago recibe la fecha con milisegundos
    assert abs(datetime.fromisoformat(preferencia["expiration_date_to"]) - vencimiento) < timedelta(milliseconds=1)
    assert preferencia["payment_methods"]["excluded_payment_types"] == [{"id": "ticket"}, {"id": "atm"}]


def test_no_se_crea_preferencia_para_una_reserva_vencida(mp, reservas, fechas):
    reserva_id = reservas(fechas, minutos=PLAZO + 1)

    response = client.post("/api/payments/create", json={"title": "Reserva", "reserva_id": str(reserva_id)})

    assert response.status_code == 409
    assert "venció" in response.json()["detail"]
    assert mp.preferencia is None


# ---------- Pago dentro y fuera del plazo ----------

def test_pago_dentro_del_plazo_confirma_la_reserva(mp, correo, reservas, fechas):
    reserva_id = reservas(fechas, minutos=PLAZO - 1)

    _webhook(_pago_aprobado(mp, reserva_id))

    reserva = _reserva(reserva_id)
    assert (reserva.estado_reserva, reserva.estado_pago) == (EstadoReservaEnum.CONFIRMADA, EstadoPagoEnum.PAGADO)
    assert correo.confirmaciones == [str(reserva_id)]
    assert mp.reembolsos == []


@pytest.mark.parametrize("ya_cancelada", [False, True])
def test_pago_tardio_con_cupo_confirma_la_reserva(mp, correo, reservas, fechas, cupo_justo, ya_cancelada):
    cupo_justo(3)
    if ya_cancelada:
        reserva_id = reservas(
            fechas, minutos=PLAZO + 30,
            estado_reserva=EstadoReservaEnum.CANCELADA, estado_pago=EstadoPagoEnum.CANCELADO,
        )
    else:
        reserva_id = reservas(fechas, minutos=PLAZO + 30)
    payment_id = _pago_aprobado(mp, reserva_id)

    _webhook(payment_id)

    reserva = _reserva(reserva_id)
    assert (reserva.estado_reserva, reserva.estado_pago) == (EstadoReservaEnum.CONFIRMADA, EstadoPagoEnum.PAGADO)
    assert correo.confirmaciones == [str(reserva_id)]
    assert mp.reembolsos == []
    assert _pago(payment_id).estado == "approved"


def test_pago_tardio_sin_cupo_se_reembolsa_y_se_avisa(mp, correo, reservas, fechas, cupo_justo):
    cupo_justo(3)
    reserva_id = reservas(fechas, minutos=PLAZO + 30)
    # Otra reserva tomó los lugares liberados
    reservas(fechas, personas=3, estado_reserva=EstadoReservaEnum.CONFIRMADA, estado_pago=EstadoPagoEnum.PAGADO)
    payment_id = _pago_aprobado(mp, reserva_id)

    response = _webhook(payment_id)

    assert response.status_code == 200
    reserva = _reserva(reserva_id)
    assert (reserva.estado_reserva, reserva.estado_pago) == (EstadoReservaEnum.CANCELADA, EstadoPagoEnum.CANCELADO)
    assert mp.reembolsos == [payment_id]
    assert correo.confirmaciones == []
    assert len(correo.cancelaciones) == 1
    assert "Te devolvimos el dinero" in correo.cancelaciones[0]["motivo_cancelacion"]
    # El pago queda registrado, marcado como devuelto
    pago = _pago(payment_id)
    assert pago.estado == "refunded"
    assert (pago.monto_devuelto, pago.devolucion_estado) == (MONTO, "devuelto")
    assert pago.fecha_devolucion is not None


def test_aviso_repetido_de_un_pago_reembolsado_no_lo_devuelve_dos_veces(mp, correo, reservas, fechas, cupo_justo):
    cupo_justo(3)
    reserva_id = reservas(fechas, minutos=PLAZO + 30)
    reservas(fechas, personas=3, estado_reserva=EstadoReservaEnum.CONFIRMADA, estado_pago=EstadoPagoEnum.PAGADO)
    payment_id = _pago_aprobado(mp, reserva_id)

    _webhook(payment_id)
    _webhook(payment_id)

    assert mp.reembolsos == [payment_id]
    assert len(correo.cancelaciones) == 1


def test_si_falla_el_reembolso_se_avisa_que_esta_en_proceso(mp, correo, reservas, fechas, cupo_justo):
    mp.reembolso_falla = True
    cupo_justo(3)
    reserva_id = reservas(fechas, minutos=PLAZO + 30)
    reservas(fechas, personas=3, estado_reserva=EstadoReservaEnum.CONFIRMADA, estado_pago=EstadoPagoEnum.PAGADO)
    payment_id = _pago_aprobado(mp, reserva_id)

    _webhook(payment_id)

    assert _reserva(reserva_id).estado_reserva == EstadoReservaEnum.CANCELADA
    assert len(correo.cancelaciones) == 1
    assert "Estamos procesando la devolución" in correo.cancelaciones[0]["motivo_cancelacion"]
    # Sigue figurando como aprobado y queda marcado para devolverlo a mano
    pago = _pago(payment_id)
    assert pago.estado == "approved"
    assert (pago.monto_devuelto, pago.devolucion_estado) == (MONTO, "pendiente_revision")
    assert pago.fecha_devolucion is None


def test_reconciliacion_de_un_pago_tardio_sin_cupo_lo_reembolsa(mp, correo, reservas, fechas, cupo_justo, como_admin):
    cupo_justo(3)
    reserva_id = reservas(
        fechas, minutos=PLAZO + 30,
        estado_reserva=EstadoReservaEnum.CANCELADA, estado_pago=EstadoPagoEnum.CANCELADO,
    )
    reservas(fechas, personas=3, estado_reserva=EstadoReservaEnum.CONFIRMADA, estado_pago=EstadoPagoEnum.PAGADO)
    payment_id = _pago_aprobado(mp, reserva_id)

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "reembolsado"
    assert mp.reembolsos == [payment_id]
    assert len(correo.cancelaciones) == 1


def test_reconciliacion_de_una_reserva_vencida_sin_pagos(mp, correo, reservas, fechas, como_admin):
    reserva_id = reservas(
        fechas, minutos=PLAZO + 30,
        estado_reserva=EstadoReservaEnum.CANCELADA, estado_pago=EstadoPagoEnum.CANCELADO,
    )

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    assert response.json()["status"] == "vencida"
    assert correo.confirmaciones == correo.cancelaciones == []
