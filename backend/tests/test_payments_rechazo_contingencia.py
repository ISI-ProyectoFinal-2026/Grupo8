import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import User
from services.payment_service import payment_service

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado (FK)
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

PENDIENTE = (EstadoPagoEnum.PENDIENTE, EstadoReservaEnum.PENDIENTE)
PAGADA = (EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA)


# ---------- Dobles de prueba ----------

class MercadoPagoFalso:
    """Reemplaza al SDK de Mercado Pago. Registra cada llamada que recibe."""

    def __init__(
        self,
        reserva_id=None,
        estado_pago="approved",
        status_detail="accredited",
        http_get=200,
        error_get=None,
        resultados_busqueda=None,
        error_search=None,
        respuesta_create=None,
        error_create=None,
    ):
        self.reserva_id = reserva_id
        self.estado_pago = estado_pago
        self.status_detail = status_detail
        self.http_get = http_get
        self.error_get = error_get
        self.resultados_busqueda = resultados_busqueda or []
        self.error_search = error_search
        self.respuesta_create = respuesta_create
        self.error_create = error_create
        self.llamadas = {"get": [], "search": [], "create": []}

    def payment(self):
        return self

    def preference(self):
        return self

    def get(self, payment_id):
        self.llamadas["get"].append(payment_id)
        if self.error_get:
            raise self.error_get
        if self.http_get != 200:
            return {"status": self.http_get, "response": {}}
        return {
            "status": 200,
            "response": {
                "id": payment_id,
                "status": self.estado_pago,
                "status_detail": self.status_detail,
                "external_reference": self.reserva_id,
            },
        }

    def search(self, filtros):
        self.llamadas["search"].append(filtros)
        if self.error_search:
            raise self.error_search
        return {"response": {"results": self.resultados_busqueda}}

    def create(self, datos):
        self.llamadas["create"].append(datos)
        if self.error_create:
            raise self.error_create
        return self.respuesta_create or {
            "status": 201,
            "response": {"sandbox_init_point": "https://mp.test/init"},
        }


class SecurityServiceFalso:
    payloads = []

    def generate_offline_qr_token(self, payload):
        SecurityServiceFalso.payloads.append(payload)
        return "jwt-de-prueba"


class EmailServiceFalso:
    enviados = []

    def enviar_confirmacion_sync(self, destinatario, datos_reserva, jwt_token):
        EmailServiceFalso.enviados.append(destinatario)


# ---------- Fixtures y helpers ----------

@pytest.fixture(autouse=True)
def servicios_falsos(monkeypatch):
    """QR y correo nunca son reales en estos tests."""
    SecurityServiceFalso.payloads = []
    EmailServiceFalso.enviados = []
    monkeypatch.setattr("api.payments.SecurityService", SecurityServiceFalso)
    monkeypatch.setattr("api.payments.email_service", EmailServiceFalso())


@pytest.fixture
def instalar_mp(monkeypatch):
    def _instalar(**kwargs):
        mp = MercadoPagoFalso(**kwargs)
        monkeypatch.setattr(payment_service, "mp", mp)
        return mp

    return _instalar


@pytest.fixture
def crear_reserva():
    """Factory: crea usuario + reserva y los borra al terminar el test."""
    creados = []

    def _crear(estado_pago=EstadoPagoEnum.PENDIENTE, estado_reserva=EstadoReservaEnum.PENDIENTE):
        db = SessionLocal()
        try:
            usuario = User(
                email=f"rechazo_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre="Usuario Logueado",
                dni=f"R{uuid.uuid4().hex[:10]}",
                is_socio=False,
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
                email="titular@real.com",
                telefono="2604123456",
                estado_reserva=estado_reserva,
                estado_pago=estado_pago,
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


def _crear_preferencia(reserva_id):
    return client.post(
        "/api/payments/create",
        json={"title": "Entrada General - 3 personas", "reserva_id": str(reserva_id)},
    )


def _reconciliar(reserva_id):
    return client.get(f"/api/payments/reconcile/{reserva_id}")


# ======================================================================
# 1. Pago rechazado
# ======================================================================

@pytest.mark.parametrize(
    "status_detail",
    [
        "cc_rejected_insufficient_amount",  # fondos insuficientes
        "cc_rejected_call_for_authorize",   # falla de autorización / autenticación
    ],
)
def test_webhook_pago_rechazado_no_toca_la_reserva_ni_emite_qr_ni_mail(
    instalar_mp, crear_reserva, status_detail
):
    reserva_id = crear_reserva()
    mp = instalar_mp(
        reserva_id=str(reserva_id), estado_pago="rejected", status_detail=status_detail
    )

    response = _webhook("777")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert mp.llamadas["get"] == ["777"]  # se consultó el estado real a MP
    assert _estados(reserva_id) == PENDIENTE
    assert SecurityServiceFalso.payloads == []
    assert EmailServiceFalso.enviados == []


def test_tras_un_rechazo_se_puede_reintentar_y_pagar_la_misma_reserva(
    instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    mp = instalar_mp(
        reserva_id=str(reserva_id),
        estado_pago="rejected",
        status_detail="cc_rejected_insufficient_amount",
    )

    _webhook("1")
    assert _estados(reserva_id) == PENDIENTE

    # "Intentar nuevamente": una reserva sin pago aprobado admite una nueva preferencia
    reintento = _crear_preferencia(reserva_id)
    assert reintento.status_code == 200
    assert reintento.json()["init_point"] == "https://mp.test/init"
    assert len(mp.llamadas["create"]) == 1

    # El segundo intento sale bien
    mp.estado_pago = "approved"
    _webhook("2")

    assert _estados(reserva_id) == PAGADA
    assert EmailServiceFalso.enviados == ["titular@real.com"]


def test_crear_preferencia_rechazada_por_mp_devuelve_400_y_no_toca_la_reserva(
    instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    instalar_mp(respuesta_create={"status": 400, "response": {"message": "invalid"}})

    response = _crear_preferencia(reserva_id)

    assert response.status_code == 400
    assert response.json()["detail"] == "Rechazado por Mercado Pago"
    assert _estados(reserva_id) == PENDIENTE


def test_crear_preferencia_con_mp_caido_devuelve_500_y_no_toca_la_reserva(
    instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    instalar_mp(error_create=ConnectionError("MP no responde"))

    response = _crear_preferencia(reserva_id)

    assert response.status_code == 500
    assert _estados(reserva_id) == PENDIENTE


# ======================================================================
# 2. Detectar y evitar cobro duplicado
# ======================================================================

def test_no_se_genera_cobro_sobre_una_reserva_ya_pagada(instalar_mp, crear_reserva):
    reserva_id = crear_reserva(
        estado_pago=EstadoPagoEnum.PAGADO, estado_reserva=EstadoReservaEnum.CONFIRMADA
    )
    mp = instalar_mp()

    response = _crear_preferencia(reserva_id)

    assert response.status_code == 409
    assert mp.llamadas["create"] == []  # no se abrió un nuevo checkout
    assert _estados(reserva_id) == PAGADA


def test_no_se_genera_cobro_sobre_una_reserva_cancelada(instalar_mp, crear_reserva):
    reserva_id = crear_reserva(estado_reserva=EstadoReservaEnum.CANCELADA)
    mp = instalar_mp()

    response = _crear_preferencia(reserva_id)

    assert response.status_code == 409
    assert mp.llamadas["create"] == []


def test_no_se_genera_cobro_si_mp_ya_registra_un_pago_aprobado(instalar_mp, crear_reserva):
    # Reserva local todavía PENDIENTE (el webhook no llegó) pero MP ya cobró
    reserva_id = crear_reserva()
    mp = instalar_mp(resultados_busqueda=[{"id": 99, "status": "approved"}])

    response = _crear_preferencia(reserva_id)

    assert response.status_code == 409
    assert mp.llamadas["search"] == [{"external_reference": str(reserva_id)}]
    assert mp.llamadas["create"] == []
    # El estado no se altera: queda para que la reconciliación lo corrija
    assert _estados(reserva_id) == PENDIENTE


def test_mp_sin_pagos_aprobados_permite_la_preferencia_y_no_cambia_estados(
    instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    mp = instalar_mp(resultados_busqueda=[{"id": 5, "status": "rejected"}])

    primera = _crear_preferencia(reserva_id)
    segunda = _crear_preferencia(reserva_id)

    assert primera.status_code == 200 and segunda.status_code == 200
    assert [p["external_reference"] for p in mp.llamadas["create"]] == [str(reserva_id)] * 2
    assert [p["items"][0]["unit_price"] for p in mp.llamadas["create"]] == [15000.0] * 2
    assert _estados(reserva_id) == PENDIENTE


def test_si_falla_la_consulta_a_mp_no_se_abre_un_cobro(instalar_mp, crear_reserva):
    # Ante la duda se bloquea: es preferible no cobrar a arriesgar un cobro doble
    reserva_id = crear_reserva()
    mp = instalar_mp(error_search=ConnectionError("MP no responde"))

    response = _crear_preferencia(reserva_id)

    assert response.status_code == 500
    assert mp.llamadas["create"] == []
    assert _estados(reserva_id) == PENDIENTE


def test_webhooks_aprobados_repetidos_no_duplican_qr_ni_correo(instalar_mp, crear_reserva):
    reserva_id = crear_reserva()
    instalar_mp(reserva_id=str(reserva_id))

    _webhook("123")
    _webhook("123")  # reintento del mismo aviso
    _webhook("456")  # otro pago aprobado sobre la misma reserva

    assert _estados(reserva_id) == PAGADA
    assert len(SecurityServiceFalso.payloads) == 1
    assert EmailServiceFalso.enviados == ["titular@real.com"]


def test_reconciliar_una_reserva_ya_pagada_no_consulta_a_mp(instalar_mp, crear_reserva):
    reserva_id = crear_reserva(
        estado_pago=EstadoPagoEnum.PAGADO, estado_reserva=EstadoReservaEnum.CONFIRMADA
    )
    mp = instalar_mp(resultados_busqueda=[{"id": 99, "status": "approved"}])

    response = _reconciliar(reserva_id)

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert mp.llamadas["search"] == []
    assert _estados(reserva_id) == PAGADA


# ======================================================================
# 3. Reconciliar operación huérfana
# ======================================================================

@pytest.mark.parametrize(
    "falla_webhook",
    [
        {"error_get": ConnectionError("MP no responde")},  # excepción de red
        {"http_get": 500},                                   # MP responde con error
    ],
    ids=["excepcion_de_red", "respuesta_500"],
)
def test_webhook_falla_pero_mp_cobro_y_la_reconciliacion_actualiza_la_reserva(
    instalar_mp, crear_reserva, falla_webhook
):
    reserva_id = crear_reserva()
    mp = instalar_mp(reserva_id=str(reserva_id), **falla_webhook)

    # 1. El webhook falla: responde 200 igualmente (MP no debe reintentar sin fin)
    response = _webhook()
    assert response.status_code == 200
    assert _estados(reserva_id) == PENDIENTE  # reserva huérfana

    # 2. MP confirma que el pago sí se realizó
    mp.resultados_busqueda = [{"id": 99, "status": "approved"}]
    response = _reconciliar(reserva_id)

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "reconciliado"
    assert data["pago_id_mp"] == 99
    assert mp.llamadas["search"] == [{"external_reference": str(reserva_id)}]
    assert _estados(reserva_id) == PAGADA


def test_reconciliar_elige_el_pago_aprobado_entre_varios_intentos(instalar_mp, crear_reserva):
    reserva_id = crear_reserva()
    instalar_mp(
        resultados_busqueda=[
            {"id": 1, "status": "rejected"},
            {"id": 2, "status": "approved"},
        ]
    )

    response = _reconciliar(reserva_id)

    assert response.json()["pago_id_mp"] == 2
    assert _estados(reserva_id) == PAGADA


@pytest.mark.parametrize(
    "resultados",
    [[], [{"id": 1, "status": "rejected"}], [{"id": 2, "status": "pending"}]],
    ids=["sin_pagos", "solo_rechazado", "solo_pendiente"],
)
def test_reconciliar_sin_pago_aprobado_deja_la_reserva_pendiente(
    instalar_mp, crear_reserva, resultados
):
    reserva_id = crear_reserva()
    instalar_mp(resultados_busqueda=resultados)

    response = _reconciliar(reserva_id)

    assert response.status_code == 200
    assert response.json()["status"] == "pendiente"
    assert _estados(reserva_id) == PENDIENTE


def test_reconciliar_es_idempotente(instalar_mp, crear_reserva):
    reserva_id = crear_reserva()
    mp = instalar_mp(resultados_busqueda=[{"id": 99, "status": "approved"}])

    primera = _reconciliar(reserva_id)
    segunda = _reconciliar(reserva_id)

    assert primera.json()["status"] == "reconciliado"
    assert segunda.json()["status"] == "ok"
    assert len(mp.llamadas["search"]) == 1  # la segunda no vuelve a consultar a MP
    assert _estados(reserva_id) == PAGADA


def test_reconciliar_con_mp_caido_devuelve_500_y_no_altera_la_reserva(
    instalar_mp, crear_reserva
):
    reserva_id = crear_reserva()
    instalar_mp(error_search=ConnectionError("MP no responde"))

    response = _reconciliar(reserva_id)

    assert response.status_code == 500
    assert _estados(reserva_id) == PENDIENTE


def test_reconciliar_reserva_inexistente_devuelve_404(instalar_mp):
    instalar_mp()

    assert _reconciliar(uuid.uuid4()).status_code == 404
