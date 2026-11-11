import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Callable, Iterator, List, Optional

import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import SessionLocal
from main import app
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.tipo_reserva import FormaCobroEnum, TipoReserva
from services.capacity_service import CapacityService

client = TestClient(app)

URL_RESERVAS = "/reservas/"
URL_COTIZAR = "/reservas/cotizar"

PRECIO_PARCELA = 7000
PRECIO_CABANA = 25000


def _dia(desde_hoy: int) -> str:
    # Lejos de hoy para no cruzarse con el "hoy" de Argentina ni con otras pruebas
    return (date.today() + timedelta(days=desde_hoy)).isoformat()


def _visitante(nombre: str = "Ana Perez", edad: int = 30) -> dict:
    return {"nombre": nombre, "edad": edad, "condicion": "visitante"}


def _socio(nombre: str = "Juan Gomez", dni: str = "30111222") -> dict:
    return {"nombre": nombre, "edad": 40, "condicion": "socio", "dni": dni}


@pytest.fixture(autouse=True)
def cupo_amplio(configurar_camping, camping_de_prueba) -> None:
    """Cupo de sobra y sin buffer: estos tests prueban tipos y unidades, no la capacidad general."""
    configurar_camping(capacidad_total=100_000, porcentaje_buffer_offline=0)


@pytest.fixture
def crear_tipo() -> Iterator[Callable[..., TipoReserva]]:
    """Crea tipos en la base y al final los borra junto con sus reservas."""
    ids: List[uuid.UUID] = []

    def _crear(
        forma_cobro: FormaCobroEnum,
        precio: int,
        max_personas: int = 6,
        cantidad_unidades: Optional[int] = None,
        activo: bool = True,
    ) -> TipoReserva:
        db = SessionLocal()
        try:
            tipo = TipoReserva(
                nombre=f"Tipo prueba {uuid.uuid4().hex[:8]}",
                precio=Decimal(precio),
                forma_cobro=forma_cobro,
                max_personas=max_personas,
                cantidad_unidades=cantidad_unidades,
                activo=activo,
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
def parcela(crear_tipo) -> TipoReserva:
    return crear_tipo(FormaCobroEnum.POR_PERSONA, PRECIO_PARCELA, max_personas=4)


@pytest.fixture
def cabana(crear_tipo) -> TipoReserva:
    return crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, max_personas=6, cantidad_unidades=2)


@pytest.fixture
def reservas_sin_tipo() -> Iterator[List[str]]:
    """Ids de reservas creadas sin tipo, para borrarlas al final."""
    ids: List[str] = []
    yield ids
    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _por_persona(tipo: Optional[TipoReserva], personas: List[dict], ingreso: int = 40, egreso: int = 42) -> dict:
    datos = {"fecha_ingreso": _dia(ingreso), "fecha_egreso": _dia(egreso), "personas": personas, "email": "tipos@grupo8.com"}
    if tipo is not None:
        datos["tipo_reserva_id"] = str(tipo.id)
    return datos


def _por_unidad(tipo: TipoReserva, ingreso: int = 40, egreso: int = 43, personas: int = 4, **cambios) -> dict:
    return {
        "tipo_reserva_id": str(tipo.id),
        "fecha_ingreso": _dia(ingreso),
        "fecha_egreso": _dia(egreso),
        "titular": "Laura Diaz",
        "cantidad_personas": personas,
        "email": "cabana@grupo8.com",
        **cambios,
    }


def _guardada(reserva_id: str) -> Reserva:
    db = SessionLocal()
    try:
        return db.query(Reserva).filter(Reserva.id == reserva_id).one()
    finally:
        db.close()


def _cambiar_reserva(reserva_id: str, **valores) -> None:
    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == reserva_id).update(valores, synchronize_session=False)
        db.commit()
    finally:
        db.close()


# --- Por persona ---

def test_reserva_por_persona_usa_el_precio_del_tipo_y_los_descuentos(parcela, descuentos_fijos):
    response = client.post(URL_RESERVAS, json=_por_persona(parcela, [_visitante(), _socio()]))

    assert response.status_code == 201, response.text
    data = response.json()
    # Visitante paga el precio del tipo; el socio, con su descuento
    esperado = PRECIO_PARCELA + PRECIO_PARCELA * (100 - descuentos_fijos) / 100
    assert data["monto_total"] == esperado
    assert data["tipo_reserva_id"] == str(parcela.id)
    assert data["precio_tipo"] == PRECIO_PARCELA
    assert [p["precio_base"] for p in data["personas"]] == [PRECIO_PARCELA, PRECIO_PARCELA]
    assert data["titular"] == "Ana Perez"
    assert data["cantidad_personas"] == 2


def test_el_precio_por_persona_no_se_multiplica_por_las_noches(parcela):
    una_noche = client.post(URL_COTIZAR, json={"tipo_reserva_id": str(parcela.id), "personas": [{"edad": 30, "condicion": "visitante"}]})

    assert una_noche.json()["total"] == PRECIO_PARCELA


def test_cotizar_por_persona_con_tipo(parcela, descuentos_fijos):
    response = client.post(
        URL_COTIZAR,
        json={"tipo_reserva_id": str(parcela.id), "personas": [{"edad": 30, "condicion": "visitante"}, {"edad": 40, "condicion": "socio"}]},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["subtotal"] == PRECIO_PARCELA * 2
    assert data["total"] == PRECIO_PARCELA + PRECIO_PARCELA * (100 - descuentos_fijos) / 100
    assert data["forma_cobro"] == "POR_PERSONA"
    assert data["precio_unitario"] == PRECIO_PARCELA
    assert data["noches"] is None
    assert len(data["detalle"]) == 2


def test_sin_tipo_la_reserva_funciona_como_antes(reservas_sin_tipo):
    response = client.post(URL_RESERVAS, json=_por_persona(None, [_visitante()]))

    assert response.status_code == 201, response.text
    reservas_sin_tipo.append(response.json()["id"])
    data = response.json()
    assert data["tipo_reserva_id"] is None
    assert data["precio_tipo"] is None
    assert data["monto_total"] == settings.PRECIO_BASE_POR_PERSONA


def test_sin_tipo_la_cotizacion_funciona_como_antes():
    response = client.post(URL_COTIZAR, json={"personas": [{"edad": 30, "condicion": "visitante"}]})

    assert response.status_code == 200
    assert response.json()["total"] == settings.PRECIO_BASE_POR_PERSONA
    assert response.json()["forma_cobro"] is None


def test_un_tipo_por_persona_necesita_las_personas(parcela):
    datos = _por_persona(parcela, [_visitante()])
    del datos["personas"]
    datos.update(titular="Laura Diaz", cantidad_personas=2)

    response = client.post(URL_RESERVAS, json=datos)

    assert response.status_code == 422
    assert response.json()["detail"] == "Una reserva de este tipo necesita los datos de cada persona."


# --- Por unidad ---

def test_reserva_por_unidad_cobra_unidad_por_noches_sin_descuentos(cabana):
    response = client.post(URL_RESERVAS, json=_por_unidad(cabana, ingreso=40, egreso=43))

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["monto_total"] == PRECIO_CABANA * 3
    assert data["titular"] == "Laura Diaz"
    assert data["cantidad_personas"] == 4
    assert data["personas"] == []
    assert data["tipo_reserva_id"] == str(cabana.id)
    assert data["precio_tipo"] == PRECIO_CABANA
    assert data["estado_reserva"] == EstadoReservaEnum.PENDIENTE.value


def test_la_reserva_conserva_el_precio_del_momento(cabana):
    reserva_id = client.post(URL_RESERVAS, json=_por_unidad(cabana)).json()["id"]

    db = SessionLocal()
    try:
        db.query(TipoReserva).filter(TipoReserva.id == cabana.id).update({"precio": Decimal(99999)})
        db.commit()
    finally:
        db.close()

    guardada = _guardada(reserva_id)
    assert float(guardada.precio_tipo) == PRECIO_CABANA
    assert guardada.monto_total == PRECIO_CABANA * 3


def test_cotizar_por_unidad(cabana):
    response = client.post(
        URL_COTIZAR,
        json={"tipo_reserva_id": str(cabana.id), "cantidad_personas": 5, "fecha_ingreso": _dia(40), "fecha_egreso": _dia(42)},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == PRECIO_CABANA * 2
    assert data["subtotal"] == PRECIO_CABANA * 2
    assert data["descuento_total"] == 0
    assert data["noches"] == 2
    assert data["precio_unitario"] == PRECIO_CABANA
    assert data["forma_cobro"] == "POR_UNIDAD"
    assert data["detalle"] == []


@pytest.mark.parametrize("cambios, mensaje", [
    pytest.param({"fecha_egreso": None}, "Indicá las fechas de ingreso y egreso.", id="sin_fechas"),
    pytest.param({"cantidad_personas": None}, "Indicá la cantidad de personas.", id="sin_cantidad"),
])
def test_cotizar_por_unidad_pide_fechas_y_cantidad(cabana, cambios, mensaje):
    datos = {"tipo_reserva_id": str(cabana.id), "cantidad_personas": 2, "fecha_ingreso": _dia(40), "fecha_egreso": _dia(41), **cambios}

    response = client.post(URL_COTIZAR, json=datos)

    assert response.status_code == 422
    assert response.json()["detail"] == mensaje


def test_cotizar_por_unidad_no_acepta_personas(cabana):
    response = client.post(
        URL_COTIZAR,
        json={"tipo_reserva_id": str(cabana.id), "personas": [{"edad": 30, "condicion": "visitante"}], "fecha_ingreso": _dia(40), "fecha_egreso": _dia(41)},
    )

    assert response.status_code == 422


def test_una_reserva_por_unidad_necesita_al_menos_una_noche(cabana):
    reserva = client.post(URL_RESERVAS, json=_por_unidad(cabana, ingreso=40, egreso=40))
    cotizacion = client.post(
        URL_COTIZAR,
        json={"tipo_reserva_id": str(cabana.id), "cantidad_personas": 2, "fecha_ingreso": _dia(40), "fecha_egreso": _dia(40)},
    )

    assert reserva.status_code == 422
    assert reserva.json()["detail"] == "Una reserva por unidad necesita al menos una noche."
    assert cotizacion.status_code == 422


def test_una_reserva_por_unidad_no_acepta_la_lista_de_personas(cabana):
    datos = _por_unidad(cabana)
    del datos["titular"], datos["cantidad_personas"]
    datos["personas"] = [_visitante()]

    response = client.post(URL_RESERVAS, json=datos)

    assert response.status_code == 422
    assert response.json()["detail"] == "Una reserva por unidad pide solo el titular y la cantidad de personas."


@pytest.mark.parametrize("faltante", ["titular", "cantidad_personas"])
def test_una_reserva_por_unidad_pide_titular_y_cantidad(cabana, faltante):
    datos = _por_unidad(cabana)
    del datos[faltante]

    response = client.post(URL_RESERVAS, json=datos)

    assert response.status_code == 422
    assert response.json()["detail"] == "Indicá el titular y la cantidad de personas."


@pytest.mark.parametrize("cambios", [
    pytest.param({"titular": "L"}, id="titular_corto"),
    pytest.param({"titular": "Laura 123"}, id="titular_con_numeros"),
    pytest.param({"cantidad_personas": 0}, id="cantidad_cero"),
    pytest.param({"cantidad_personas": "3"}, id="cantidad_texto"),
    pytest.param({"personas": [{"nombre": "Ana Perez", "edad": 30, "condicion": "visitante"}]}, id="personas_y_titular"),
])
def test_datos_invalidos_de_una_reserva_por_unidad(cabana, cambios):
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, **cambios)).status_code == 422


# --- Tipo elegido ---

def test_un_tipo_desactivado_no_se_puede_reservar_ni_cotizar(crear_tipo):
    inactivo = crear_tipo(FormaCobroEnum.POR_PERSONA, PRECIO_PARCELA, activo=False)

    reserva = client.post(URL_RESERVAS, json=_por_persona(inactivo, [_visitante()]))
    cotizacion = client.post(URL_COTIZAR, json={"tipo_reserva_id": str(inactivo.id), "personas": [{"edad": 30, "condicion": "visitante"}]})

    for response in (reserva, cotizacion):
        assert response.status_code == 422
        assert response.json()["detail"] == "El tipo de reserva no existe o no está disponible."


def test_un_tipo_que_no_existe_da_422():
    response = client.post(URL_RESERVAS, json={**_por_persona(None, [_visitante()]), "tipo_reserva_id": str(uuid.uuid4())})

    assert response.status_code == 422


# --- Máximos ---

def test_por_persona_no_supera_el_maximo_del_tipo(parcela):
    personas = [_visitante(nombre=f"Persona {letra}") for letra in "ABCDE"]

    reserva = client.post(URL_RESERVAS, json=_por_persona(parcela, personas))
    cotizacion = client.post(URL_COTIZAR, json={"tipo_reserva_id": str(parcela.id), "personas": [{"edad": 30, "condicion": "visitante"}] * 5})

    for response in (reserva, cotizacion):
        assert response.status_code == 422
        assert response.json()["detail"] == f"Una reserva de {parcela.nombre} admite como máximo 4 personas."


def test_por_unidad_no_supera_el_maximo_del_tipo(cabana):
    reserva = client.post(URL_RESERVAS, json=_por_unidad(cabana, personas=7))
    cotizacion = client.post(
        URL_COTIZAR,
        json={"tipo_reserva_id": str(cabana.id), "cantidad_personas": 7, "fecha_ingreso": _dia(40), "fecha_egreso": _dia(41)},
    )

    for response in (reserva, cotizacion):
        assert response.status_code == 422
        assert response.json()["detail"] == f"Una reserva de {cabana.nombre} admite como máximo 6 personas."


def test_tampoco_supera_el_maximo_general_por_reserva(cabana, configurar_camping):
    # El tipo admite 6, pero el máximo general bajó a 3
    configurar_camping(max_personas_por_reserva=3)

    response = client.post(URL_RESERVAS, json=_por_unidad(cabana, personas=4))

    assert response.status_code == 422
    assert response.json()["detail"] == "La cantidad máxima de personas por reserva es 3."


def test_el_maximo_justo_se_acepta(cabana, parcela):
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, personas=6)).status_code == 201
    personas = [_visitante(nombre=f"Persona {letra}") for letra in "ABCD"]
    assert client.post(URL_RESERVAS, json=_por_persona(parcela, personas)).status_code == 201


# --- Unidades agotadas ---

def test_con_todas_las_unidades_ocupadas_se_rechaza(cabana):
    # La cabaña de prueba tiene 2 unidades
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 40, 43)).status_code == 201
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 41, 42)).status_code == 201

    response = client.post(URL_RESERVAS, json=_por_unidad(cabana, 41, 44))

    assert response.status_code == 409
    assert response.json()["detail"] == (
        f"No quedan unidades de {cabana.nombre} disponibles para alguna de las noches elegidas."
    )


def test_el_dia_de_egreso_libera_la_unidad(crear_tipo):
    una_sola = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=1)
    assert client.post(URL_RESERVAS, json=_por_unidad(una_sola, 40, 42)).status_code == 201

    # Entra el mismo día que sale la anterior: no comparten ninguna noche
    response = client.post(URL_RESERVAS, json=_por_unidad(una_sola, 42, 44))

    assert response.status_code == 201, response.text


def test_las_unidades_se_cuentan_noche_por_noche(cabana):
    # Dos reservas que no se pisan entre sí: cada noche hay una sola unidad ocupada
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 40, 42)).status_code == 201
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 42, 44)).status_code == 201

    # Con 2 unidades, todavía entra una reserva que abarca las cuatro noches
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 40, 44)).status_code == 201
    # Ahora todas las noches tienen las 2 unidades ocupadas
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 43, 44)).status_code == 409


def test_las_canceladas_y_las_pendientes_vencidas_no_ocupan_unidades(crear_tipo):
    una_sola = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=1)
    cancelada = client.post(URL_RESERVAS, json=_por_unidad(una_sola, 40, 42)).json()["id"]
    _cambiar_reserva(cancelada, estado_reserva=EstadoReservaEnum.CANCELADA, estado_pago=EstadoPagoEnum.CANCELADO)
    assert client.post(URL_RESERVAS, json=_por_unidad(una_sola, 40, 42)).status_code == 201, "la cancelada no ocupa"

    otra = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=1)
    vencida = client.post(URL_RESERVAS, json=_por_unidad(otra, 40, 42)).json()["id"]
    hace_rato = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        minutes=settings.RESERVA_PENDIENTE_TTL_MINUTES + 1
    )
    _cambiar_reserva(vencida, fecha_reserva=hace_rato)
    assert client.post(URL_RESERVAS, json=_por_unidad(otra, 40, 42)).status_code == 201, "la vencida no ocupa"


def test_las_confirmadas_y_las_pendientes_en_plazo_ocupan_unidades(crear_tipo):
    una_sola = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=1)
    pendiente = client.post(URL_RESERVAS, json=_por_unidad(una_sola, 40, 42)).json()["id"]
    assert client.post(URL_RESERVAS, json=_por_unidad(una_sola, 41, 43)).status_code == 409, "la pendiente en plazo ocupa"

    _cambiar_reserva(pendiente, estado_reserva=EstadoReservaEnum.CONFIRMADA, estado_pago=EstadoPagoEnum.PAGADO)
    assert client.post(URL_RESERVAS, json=_por_unidad(una_sola, 41, 43)).status_code == 409, "la confirmada ocupa"


def test_sin_cantidad_de_unidades_no_hay_limite(crear_tipo):
    sin_limite = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=None)

    for _ in range(3):
        assert client.post(URL_RESERVAS, json=_por_unidad(sin_limite, 40, 42)).status_code == 201


def test_las_unidades_de_un_tipo_no_afectan_a_otro(crear_tipo):
    primera = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=1)
    segunda = crear_tipo(FormaCobroEnum.POR_UNIDAD, PRECIO_CABANA, cantidad_unidades=1)

    assert client.post(URL_RESERVAS, json=_por_unidad(primera, 40, 42)).status_code == 201
    assert client.post(URL_RESERVAS, json=_por_unidad(segunda, 40, 42)).status_code == 201


def test_unidades_ocupadas_devuelve_la_noche_mas_cargada(cabana):
    client.post(URL_RESERVAS, json=_por_unidad(cabana, 40, 42))
    client.post(URL_RESERVAS, json=_por_unidad(cabana, 41, 43))

    db = SessionLocal()
    try:
        servicio = CapacityService()
        dia = date.today()
        # Noche 41: las dos; noche 40 o 42: una sola
        assert servicio.unidades_ocupadas(db, cabana.id, dia + timedelta(days=40), dia + timedelta(days=44)) == 2
        assert servicio.unidades_ocupadas(db, cabana.id, dia + timedelta(days=42), dia + timedelta(days=44)) == 1
        assert servicio.unidades_ocupadas(db, cabana.id, dia + timedelta(days=43), dia + timedelta(days=45)) == 0
    finally:
        db.close()


# --- Capacidad total del camping ---

def test_las_personas_de_una_cabana_cuentan_para_la_capacidad(cabana, parcela, configurar_camping):
    configurar_camping(capacidad_total=6, porcentaje_buffer_offline=0)
    db = SessionLocal()
    try:
        ocupados_antes = CapacityService().lugares_ocupados(
            db, date.today() + timedelta(days=40), date.today() + timedelta(days=43)
        )
    finally:
        db.close()
    # Se deja lugar justo para la cabaña de 4 personas y 2 más
    configurar_camping(capacidad_total=ocupados_antes + 6)

    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 40, 43, personas=4)).status_code == 201
    # Quedan 2 lugares: 3 personas más no entran, ni por persona ni en otra cabaña
    tres = [_visitante(nombre=f"Persona {letra}") for letra in "ABC"]
    assert client.post(URL_RESERVAS, json=_por_persona(parcela, tres, 41, 42)).status_code == 400
    assert client.post(URL_RESERVAS, json=_por_unidad(cabana, 41, 42, personas=3)).status_code == 400
    # Dos sí
    assert client.post(URL_RESERVAS, json=_por_persona(parcela, tres[:2], 41, 42)).status_code == 201
