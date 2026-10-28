import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from main import app
from models.descuento import AplicaDescuentoEnum, Descuento
from models.reserva import Reserva
from schemas.reserva import hoy_argentina
from services.payment_service import payment_service
from services.pricing_service import PricingService

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Las reservas necesitan el camping cargado
pytestmark = pytest.mark.usefixtures("camping_de_prueba")

INGRESO = hoy_argentina() + timedelta(days=30)
EGRESO = INGRESO + timedelta(days=2)
BASE = settings.PRECIO_BASE_POR_PERSONA

PERSONAS = [
    {"nombre": "Ana Pérez", "edad": 34, "condicion": "socio", "dni": "30111222"},
    {"nombre": "Luis Pérez", "edad": 8, "condicion": "visitante"},
    {"nombre": "Marta Gómez", "edad": 61, "condicion": "visitante"},
]


def _para_cotizar(personas) -> list:
    """De los datos de una reserva, lo que pide la cotización."""
    return [{"edad": p["edad"], "condicion": p["condicion"]} for p in personas]


def _payload_reserva(personas=PERSONAS) -> dict:
    return {
        "fecha_ingreso": INGRESO.isoformat(),
        "fecha_egreso": EGRESO.isoformat(),
        "personas": personas,
        "email": "ana@test.com",
    }


def _cantidad_de_reservas() -> int:
    db = SessionLocal()
    try:
        return db.query(Reserva).count()
    finally:
        db.close()


class MercadoPagoFalso:
    """Reemplaza al SDK de Mercado Pago y se queda con la preferencia que le mandan."""

    def __init__(self):
        self.preferencia = None

    def payment(self):
        return self

    def preference(self):
        return self

    def search(self, filtros):
        return {"response": {"results": []}}

    def create(self, datos):
        self.preferencia = datos
        return {"status": 201, "response": {"sandbox_init_point": "https://mp.test/init"}}


@pytest.fixture
def reservas_creadas(monkeypatch):
    # Estos tests no miran la capacidad, así que la subimos para que no dependa de la BD local
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for reserva_id in ids:
            db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def mercado_pago(monkeypatch):
    falso = MercadoPagoFalso()
    monkeypatch.setattr(payment_service, "mp", falso)
    return falso


# ---------- POST /reservas/cotizar ----------

def test_cotizar_es_publico_y_devuelve_subtotal_descuento_y_total(descuentos_fijos):
    response = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)})

    assert response.status_code == 200, response.text
    data = response.json()
    descuento = BASE * descuentos_fijos / 100
    assert data["moneda"] == "ARS"
    assert data["subtotal"] == pytest.approx(3 * BASE)
    assert data["descuento_total"] == pytest.approx(descuento)
    assert data["total"] == pytest.approx(3 * BASE - descuento)
    assert data["cantidad_socios"] == 1


def test_cotizar_detalla_el_precio_de_cada_persona(descuentos_fijos):
    response = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)})

    socia, *visitantes = response.json()["detalle"]
    assert socia["indice"] == 0
    assert socia["condicion_efectiva"] == "socio"
    assert socia["descuento_codigo"] == "socio"
    assert socia["descuento_pct"] == descuentos_fijos
    assert socia["precio_base"] == BASE
    assert socia["precio_final"] == pytest.approx(BASE * (1 - descuentos_fijos / 100))
    assert [v["indice"] for v in visitantes] == [1, 2]
    for visitante in visitantes:
        assert visitante["condicion_efectiva"] == "visitante"
        assert visitante["descuento_codigo"] is None
        assert visitante["descuento_pct"] == 0
        assert visitante["precio_final"] == BASE


def test_cotizar_solo_visitantes_no_tiene_descuento():
    response = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS[1:])})

    data = response.json()
    assert data["descuento_total"] == 0
    assert data["total"] == data["subtotal"] == 2 * BASE
    assert data["cantidad_socios"] == 0


def test_cotizar_no_guarda_ninguna_reserva():
    antes = _cantidad_de_reservas()

    response = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)})

    assert response.status_code == 200
    assert _cantidad_de_reservas() == antes


def test_cotizar_aplica_los_descuentos_por_edad_de_la_tabla(monkeypatch):
    menores = Descuento(
        codigo="menores", nombre="Menores", aplica_a=AplicaDescuentoEnum.edad,
        porcentaje=Decimal("50"), edad_min=0, edad_max=11, activo=True,
    )
    socio = Descuento(
        codigo="socio", nombre="Socios", aplica_a=AplicaDescuentoEnum.socio, porcentaje=Decimal("20"), activo=True,
    )
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(lambda db: [socio, menores]))

    response = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)})

    detalle = response.json()["detalle"]
    assert [d["descuento_codigo"] for d in detalle] == ["socio", "menores", None]
    assert response.json()["total"] == pytest.approx(BASE * 0.8 + BASE * 0.5 + BASE)


def test_cotizar_sin_descuentos_activos_cobra_el_precio_base(monkeypatch):
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(lambda db: []))

    response = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)})

    assert response.json()["total"] == 3 * BASE


def test_cotizar_no_toma_ningun_importe_del_cliente():
    # Si el cliente intenta mandar un precio, se ignora: el backend calcula todo
    cuerpo = {"personas": _para_cotizar(PERSONAS), "total": 1, "precio_base": 1, "descuento_total": 99999}

    response = client.post("/reservas/cotizar", json=cuerpo)

    assert response.status_code == 200
    assert response.json()["subtotal"] == pytest.approx(3 * BASE)


CASOS_INVALIDOS = [
    pytest.param({}, id="sin_personas"),
    pytest.param({"personas": []}, id="lista_vacia"),
    pytest.param({"personas": "Ana"}, id="no_es_lista"),
    pytest.param({"personas": [{"edad": 30, "condicion": "visitante"}] * (settings.MAX_PERSONAS_POR_RESERVA + 1)},
                 id="mas_del_maximo"),
    pytest.param({"personas": [{"condicion": "visitante"}]}, id="sin_edad"),
    pytest.param({"personas": [{"edad": 30}]}, id="sin_condicion"),
    pytest.param({"personas": [{"edad": -1, "condicion": "visitante"}]}, id="edad_negativa"),
    pytest.param({"personas": [{"edad": 121, "condicion": "visitante"}]}, id="edad_mayor_al_maximo"),
    pytest.param({"personas": [{"edad": "30", "condicion": "visitante"}]}, id="edad_texto"),
    pytest.param({"personas": [{"edad": 2.5, "condicion": "visitante"}]}, id="edad_decimal"),
    pytest.param({"personas": [{"edad": True, "condicion": "visitante"}]}, id="edad_booleana"),
    pytest.param({"personas": [{"edad": None, "condicion": "visitante"}]}, id="edad_nula"),
    pytest.param({"personas": [{"edad": 30, "condicion": "invitado"}]}, id="condicion_desconocida"),
]


@pytest.mark.parametrize("cuerpo", CASOS_INVALIDOS)
def test_cotizar_rechaza_datos_invalidos_con_422(cuerpo):
    assert client.post("/reservas/cotizar", json=cuerpo).status_code == 422


def test_cotizar_acepta_el_maximo_de_personas():
    personas = [{"edad": 30, "condicion": "visitante"}] * settings.MAX_PERSONAS_POR_RESERVA

    response = client.post("/reservas/cotizar", json={"personas": personas})

    assert response.status_code == 200
    assert response.json()["total"] == settings.MAX_PERSONAS_POR_RESERVA * BASE


# ---------- Cotización = reserva = Mercado Pago ----------

def test_el_total_cotizado_es_el_de_la_reserva_y_el_que_se_manda_a_mercado_pago(reservas_creadas, mercado_pago):
    cotizacion = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)}).json()

    reserva = client.post("/reservas/", json=_payload_reserva())
    assert reserva.status_code == 201, reserva.text
    reserva = reserva.json()
    reservas_creadas.append(reserva["id"])

    pago = client.post("/api/payments/create", json={"title": "Reserva", "reserva_id": reserva["id"]})
    assert pago.status_code == 200, pago.text
    unit_price = mercado_pago.preferencia["items"][0]["unit_price"]

    assert cotizacion["total"] == reserva["monto_total"] == unit_price
    assert mercado_pago.preferencia["items"][0]["quantity"] == 1
    assert mercado_pago.preferencia["external_reference"] == reserva["id"]


def test_el_detalle_cotizado_coincide_con_lo_guardado_en_cada_persona(reservas_creadas):
    cotizacion = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)}).json()

    reserva = client.post("/reservas/", json=_payload_reserva()).json()
    reservas_creadas.append(reserva["id"])

    for cotizada, guardada in zip(cotizacion["detalle"], reserva["personas"]):
        assert cotizada["precio_base"] == guardada["precio_base"]
        assert cotizada["descuento_pct"] == guardada["descuento_pct"]
        assert cotizada["precio_final"] == guardada["precio_final"]
    assert cotizacion["total"] == sum(p["precio_final"] for p in reserva["personas"])


def test_con_descuentos_por_edad_cotizacion_reserva_y_pago_siguen_coincidiendo(
    monkeypatch, reservas_creadas, mercado_pago
):
    socio = Descuento(
        codigo="socio", nombre="Socios", aplica_a=AplicaDescuentoEnum.socio, porcentaje=Decimal("25"), activo=True,
    )
    menores = Descuento(
        codigo="menores", nombre="Menores", aplica_a=AplicaDescuentoEnum.edad,
        porcentaje=Decimal("33.33"), edad_min=0, edad_max=11, activo=True,
    )
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(lambda db: [socio, menores]))

    cotizacion = client.post("/reservas/cotizar", json={"personas": _para_cotizar(PERSONAS)}).json()
    reserva = client.post("/reservas/", json=_payload_reserva()).json()
    reservas_creadas.append(reserva["id"])
    client.post("/api/payments/create", json={"title": "Reserva", "reserva_id": reserva["id"]})

    assert cotizacion["total"] == reserva["monto_total"] == mercado_pago.preferencia["items"][0]["unit_price"]
    # 5000 * 0.75 + 5000 * 0.6667 (redondeado a 3333.50) + 5000
    assert cotizacion["total"] == pytest.approx(BASE * 0.75 + 3333.50 + BASE)


def test_el_monto_de_la_reserva_no_lo_decide_el_cliente(reservas_creadas, descuentos_fijos):
    payload = _payload_reserva()
    payload["monto_total"] = 1.0

    reserva = client.post("/reservas/", json=payload).json()
    reservas_creadas.append(reserva["id"])

    assert reserva["monto_total"] == pytest.approx(3 * BASE - BASE * descuentos_fijos / 100)


def test_el_pago_cobra_el_monto_guardado_aunque_cambien_los_descuentos(monkeypatch, reservas_creadas, mercado_pago):
    reserva = client.post("/reservas/", json=_payload_reserva()).json()
    reservas_creadas.append(reserva["id"])
    # Después de reservar, el administrador deja de ofrecer descuentos
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(lambda db: []))

    client.post("/api/payments/create", json={"title": "Reserva", "reserva_id": reserva["id"]})

    assert mercado_pago.preferencia["items"][0]["unit_price"] == reserva["monto_total"]
