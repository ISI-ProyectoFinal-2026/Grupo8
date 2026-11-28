import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable, Iterator, List, Optional

import pytest
from fastapi.testclient import TestClient

from core.database import SessionLocal
from main import app
from models.reserva import Reserva
from models.tipo_reserva import FormaCobroEnum, TipoReserva
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services.auth_service import hash_password

client = TestClient(app)

URL_RESERVAS = "/reservas/"
URL_COTIZAR = "/reservas/cotizar"
PREFIJO_EMAIL = "cabanasocio_"
PRECIO_CABANA = 25000
PRECIO_PARCELA = 7000


def _dia(desde_hoy: int) -> str:
    return (date.today() + timedelta(days=desde_hoy)).isoformat()


def _dni() -> str:
    return str(uuid.uuid4().int)[:8]


@pytest.fixture(autouse=True)
def cupo_amplio(configurar_camping, camping_de_prueba) -> None:
    """Cupo de sobra y sin buffer: estos tests prueban precios, no la capacidad general."""
    configurar_camping(capacidad_total=100_000, porcentaje_buffer_offline=0)


@pytest.fixture
def crear_tipo() -> Iterator[Callable[..., TipoReserva]]:
    """Crea tipos en la base y al final los borra junto con sus reservas."""
    ids: List[uuid.UUID] = []

    def _crear(forma_cobro: FormaCobroEnum, precio: int, max_personas: int = 6) -> TipoReserva:
        db = SessionLocal()
        try:
            tipo = TipoReserva(
                nombre=f"Tipo prueba {uuid.uuid4().hex[:8]}",
                precio=Decimal(precio),
                forma_cobro=forma_cobro,
                max_personas=max_personas,
                cantidad_unidades=5 if forma_cobro == FormaCobroEnum.POR_UNIDAD else None,
                activo=True,
            )
            db.add(tipo)
            db.commit()
            db.refresh(tipo)
            db.expunge(tipo)
            ids.append(tipo.id)
            return tipo
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.tipo_reserva_id.in_(ids)).delete(synchronize_session=False)
        db.query(TipoReserva).filter(TipoReserva.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def cabana(crear_tipo) -> TipoReserva:
    return crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA)


@pytest.fixture
def parcela(crear_tipo) -> TipoReserva:
    return crear_tipo(FormaCobroEnum.POR_PERSONA, PRECIO_PARCELA, max_personas=4)


@pytest.fixture
def crear_socio() -> Iterator[Callable[..., User]]:
    """Crea usuarios con DNI propio. Al terminar se borran los que se crearon."""

    def _crear(vence: Optional[date] = None, activo: bool = True, **campos) -> User:
        db = SessionLocal()
        try:
            datos = {
                "email": f"{PREFIJO_EMAIL}{uuid.uuid4().hex[:12]}@grupo8.com",
                "password_hash": hash_password("clave-socio-123"),
                "nombre": "Marta Socia",
                "dni": _dni(),
                "rol": RoleEnum.CLIENTE,
                "is_socio": True,
                "membresia_vence": vence if vence is not None else hoy_argentina() + timedelta(days=30),
                "activo": activo,
            }
            datos.update(campos)
            usuario = User(**datos)
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            return usuario
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        db.query(User).filter(User.email.like(f"{PREFIJO_EMAIL}%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _pedido_cabana(tipo: TipoReserva, noches: int = 3, **cambios) -> dict:
    return {
        "tipo_reserva_id": str(tipo.id),
        "fecha_ingreso": _dia(40),
        "fecha_egreso": _dia(40 + noches),
        "titular": "Laura Diaz",
        "cantidad_personas": 4,
        "email": "cabana@grupo8.com",
        **cambios,
    }


def _pedido_cotizar(tipo: TipoReserva, noches: int = 3, **cambios) -> dict:
    return {
        "tipo_reserva_id": str(tipo.id),
        "cantidad_personas": 4,
        "fecha_ingreso": _dia(40),
        "fecha_egreso": _dia(40 + noches),
        **cambios,
    }


def _guardada(reserva_id: str) -> Reserva:
    db = SessionLocal()
    try:
        return db.query(Reserva).filter(Reserva.id == reserva_id).one()
    finally:
        db.close()


def _con_descuento(importe: float, porcentaje: int) -> float:
    return float(Decimal(str(importe)) * (100 - porcentaje) / 100)


# --- Cabaña con el DNI de un socio ---

def test_cabana_sin_dni_no_tiene_descuento(cabana):
    response = client.post(URL_RESERVAS, json=_pedido_cabana(cabana))

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["monto_total"] == PRECIO_CABANA * 3
    assert data["dni_titular"] is None
    assert data["descuento_pct"] is None
    assert data["descuento_total"] == 0


@pytest.mark.parametrize("noches", [1, 3, 7])
def test_cabana_con_dni_de_socio_vigente_descuenta_sobre_precio_por_noches(
    cabana, crear_socio, descuentos_fijos, noches
):
    socio = crear_socio()

    response = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, noches, dni_titular=socio.dni))

    assert response.status_code == 201, response.text
    data = response.json()
    subtotal = PRECIO_CABANA * noches
    assert data["monto_total"] == _con_descuento(subtotal, descuentos_fijos)
    assert data["descuento_pct"] == descuentos_fijos
    assert data["descuento_total"] == subtotal - data["monto_total"]
    assert data["dni_titular"] == socio.dni
    # El precio del tipo no se toca: es el de la unidad por noche
    assert data["precio_tipo"] == PRECIO_CABANA
    assert data["personas"] == []


def test_la_reserva_guarda_el_dni_y_el_porcentaje_aplicado(cabana, crear_socio, descuentos_fijos):
    socio = crear_socio()

    reserva_id = client.post(
        URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular=socio.dni)
    ).json()["id"]

    guardada = _guardada(reserva_id)
    assert guardada.dni_titular == socio.dni
    assert guardada.descuento_pct == Decimal(descuentos_fijos)
    assert guardada.monto_total == _con_descuento(PRECIO_CABANA * 3, descuentos_fijos)


def test_un_dni_en_blanco_se_trata_como_si_no_se_hubiera_enviado(cabana):
    response = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular="  "))

    assert response.status_code == 201, response.text
    assert response.json()["monto_total"] == PRECIO_CABANA * 3
    assert response.json()["dni_titular"] is None


# --- DNI que no valida como socio: mismos mensajes que en la carpa ---

@pytest.mark.parametrize(
    "caso,mensaje",
    [
        ("inexistente", "no corresponde a un socio"),
        ("no_socio", "no corresponde a un socio"),
        ("vencido", "tiene la membresía vencida"),
        ("de_baja", "no corresponde a un socio"),
    ],
)
def test_un_dni_que_no_es_socio_vigente_rechaza_la_reserva_y_no_guarda_nada(
    caso, mensaje, cabana, crear_socio
):
    if caso == "inexistente":
        dni = "99999997"
    elif caso == "no_socio":
        dni = crear_socio(is_socio=False).dni
    elif caso == "vencido":
        dni = crear_socio(vence=hoy_argentina() - timedelta(days=1)).dni
    else:
        dni = crear_socio(activo=False).dni

    response = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular=dni))

    assert response.status_code == 422
    assert mensaje in response.json()["detail"]
    assert dni in response.json()["detail"]
    db = SessionLocal()
    try:
        assert db.query(Reserva).filter(Reserva.tipo_reserva_id == cabana.id).count() == 0
    finally:
        db.close()


def test_el_dni_con_formato_invalido_se_rechaza(cabana):
    response = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular="12.345.678"))

    assert response.status_code == 422
    assert "El DNI debe tener 7 u 8 dígitos" in response.text


def test_la_membresia_que_vence_hoy_todavia_da_descuento(cabana, crear_socio, descuentos_fijos):
    socio = crear_socio(vence=hoy_argentina())

    response = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular=socio.dni))

    assert response.status_code == 201, response.text
    assert response.json()["descuento_pct"] == descuentos_fijos


# --- La cotización da lo mismo que la creación ---

@pytest.mark.parametrize("con_dni", [False, True])
def test_cotizar_la_cabana_da_lo_mismo_que_crear_la_reserva(cabana, crear_socio, con_dni):
    extra = {"dni_titular": crear_socio().dni} if con_dni else {}

    cotizacion = client.post(URL_COTIZAR, json=_pedido_cotizar(cabana, **extra))
    reserva = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, **extra))

    assert cotizacion.status_code == 200, cotizacion.text
    assert reserva.status_code == 201, reserva.text
    assert cotizacion.json()["total"] == reserva.json()["monto_total"]
    assert cotizacion.json()["descuento_total"] == reserva.json()["descuento_total"]


def test_cotizar_con_dni_de_socio_muestra_el_descuento(cabana, crear_socio, descuentos_fijos):
    socio = crear_socio()

    response = client.post(URL_COTIZAR, json=_pedido_cotizar(cabana, dni_titular=socio.dni))

    assert response.status_code == 200, response.text
    datos = response.json()
    subtotal = PRECIO_CABANA * 3
    assert datos["subtotal"] == subtotal
    assert datos["total"] == _con_descuento(subtotal, descuentos_fijos)
    assert datos["descuento_total"] == subtotal - datos["total"]
    assert datos["descuento_pct"] == descuentos_fijos
    assert datos["cantidad_socios"] == 1
    assert datos["noches"] == 3


def test_cotizar_sin_dni_no_descuenta_ni_da_error(cabana):
    response = client.post(URL_COTIZAR, json=_pedido_cotizar(cabana))

    assert response.status_code == 200, response.text
    datos = response.json()
    assert datos["total"] == PRECIO_CABANA * 3
    assert datos["descuento_total"] == 0
    assert datos["descuento_pct"] is None
    assert datos["cantidad_socios"] == 0


def test_cotizar_con_un_dni_que_no_es_socio_da_el_mismo_error_que_crear(cabana, crear_socio):
    dni = crear_socio(vence=hoy_argentina() - timedelta(days=1)).dni

    cotizacion = client.post(URL_COTIZAR, json=_pedido_cotizar(cabana, dni_titular=dni))
    reserva = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular=dni))

    assert cotizacion.status_code == reserva.status_code == 422
    assert cotizacion.json()["detail"] == reserva.json()["detail"]


def test_el_dni_del_titular_no_se_acepta_junto_con_las_personas(parcela):
    pedido = {
        "tipo_reserva_id": str(parcela.id),
        "personas": [{"edad": 30, "condicion": "visitante"}],
        "dni_titular": "30111222",
    }

    assert client.post(URL_COTIZAR, json=pedido).status_code == 422


# --- Lo que ve el administrador ---

def test_el_detalle_del_panel_muestra_el_dni_y_el_descuento(cabana, crear_socio, como_admin, descuentos_fijos):
    socio = crear_socio()
    reserva_id = client.post(URL_RESERVAS, json=_pedido_cabana(cabana, dni_titular=socio.dni)).json()["id"]

    response = client.get(f"{URL_RESERVAS}{reserva_id}")

    assert response.status_code == 200, response.text
    datos = response.json()
    assert datos["dni_titular"] == socio.dni
    assert datos["descuento_pct"] == descuentos_fijos
    assert datos["descuento_total"] == PRECIO_CABANA * 3 - datos["monto_total"]


# --- La carpa sigue como estaba ---

@pytest.mark.socios_reales
def test_la_carpa_con_socio_vigente_sigue_descontando(parcela, crear_socio, descuentos_fijos):
    socio = crear_socio()
    pedido = {
        "tipo_reserva_id": str(parcela.id),
        "fecha_ingreso": _dia(40),
        "fecha_egreso": _dia(42),
        "email": "carpa@grupo8.com",
        "personas": [{"nombre": "Marta Socia", "edad": 40, "condicion": "socio", "dni": socio.dni}],
    }

    response = client.post(URL_RESERVAS, json=pedido)

    assert response.status_code == 201, response.text
    data = response.json()
    subtotal = PRECIO_PARCELA * 2
    assert data["monto_total"] == _con_descuento(subtotal, descuentos_fijos)
    assert data["personas"][0]["descuento_pct"] == descuentos_fijos
    # El descuento total sale de las filas de personas, como antes
    assert data["descuento_total"] == subtotal - data["monto_total"]
    assert data["dni_titular"] is None
