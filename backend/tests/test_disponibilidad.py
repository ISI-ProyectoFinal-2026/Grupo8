import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterator, List

import pytest
from fastapi.testclient import TestClient

from core.database import SessionLocal
from main import app
from models.reserva import EstadoReservaEnum, Reserva
from schemas.reserva import hoy_argentina
from services.camping_service import cupo_online
from services.capacity_service import CapacityService

client = TestClient(app)

URL = "/disponibilidad"

# Capacidad 100 con 20 % de buffer: se venden 80 lugares por la web
CAPACIDAD = 100
BUFFER = 20
CUPO = 80

# Fechas lejanas para no mezclarse con reservas reales de la base
DIA = date(2097, 3, 10)


def _ahora_utc() -> datetime:
    # Como se guarda fecha_reserva: UTC sin zona horaria
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture(autouse=True)
def cupo_conocido(configurar_camping, camping_de_prueba) -> None:
    configurar_camping(capacidad_total=CAPACIDAD, porcentaje_buffer_offline=BUFFER)


@pytest.fixture
def crear_reserva(camping_de_prueba) -> Iterator[Callable[..., None]]:
    """Crea reservas directo en la base (con la antigüedad que se pida) y las borra al terminar."""
    creadas: List[uuid.UUID] = []

    def _crear(
        personas: int,
        ingreso: date = DIA,
        egreso: date = DIA,
        estado: EstadoReservaEnum = EstadoReservaEnum.CONFIRMADA,
        antiguedad: timedelta = timedelta(0),
    ) -> None:
        db = SessionLocal()
        try:
            reserva = Reserva(
                camping_id=camping_de_prueba,
                fecha_reserva=_ahora_utc() - antiguedad,
                fecha_ingreso=ingreso,
                fecha_egreso=egreso,
                cantidad_personas=personas,
                monto_total=10000.0,
                titular="Titular Secreto",
                email="secreto@privado.com",
                estado_reserva=estado,
            )
            db.add(reserva)
            db.commit()
            creadas.append(reserva.id)
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id.in_(creadas)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _consultar(desde: date = DIA, dias: int = 1, **extra):
    return client.get(URL, params={"desde": desde.isoformat(), "dias": dias, **extra})


def _dia(datos: dict, fecha: date) -> dict:
    return next(d for d in datos["dias"] if d["fecha"] == fecha.isoformat())


# --- Un día ---

def test_un_dia_sin_reservas_tiene_todo_el_cupo_libre():
    response = _consultar()

    assert response.status_code == 200, response.text
    datos = response.json()
    assert datos["cupo_maximo"] == CUPO
    assert datos["dias"] == [
        {"fecha": DIA.isoformat(), "ocupados": 0, "disponibles": CUPO, "completo": False}
    ]
    assert datos["estadia"] is None


def test_un_dia_con_ocupacion_parcial_informa_la_cantidad_exacta(crear_reserva):
    crear_reserva(personas=12)
    crear_reserva(personas=3)

    dia = _dia(_consultar().json(), DIA)

    assert dia["ocupados"] == 15
    assert dia["disponibles"] == CUPO - 15
    assert dia["completo"] is False


def test_un_dia_que_alcanzo_el_cupo_figura_como_completo(crear_reserva):
    crear_reserva(personas=CUPO)

    dia = _dia(_consultar().json(), DIA)

    assert dia["ocupados"] == CUPO
    assert dia["disponibles"] == 0
    assert dia["completo"] is True


def test_con_un_lugar_libre_todavia_no_esta_completo(crear_reserva):
    crear_reserva(personas=CUPO - 1)

    dia = _dia(_consultar().json(), DIA)

    assert dia["disponibles"] == 1
    assert dia["completo"] is False


def test_una_ocupacion_mayor_al_cupo_no_da_lugares_negativos(crear_reserva):
    crear_reserva(personas=CUPO + 5)

    dia = _dia(_consultar().json(), DIA)

    assert dia["disponibles"] == 0
    assert dia["completo"] is True


# --- Varios días y cualquier fecha ---

def test_cada_dia_devuelve_su_propia_disponibilidad(crear_reserva):
    crear_reserva(personas=10, ingreso=DIA, egreso=DIA + timedelta(days=1))
    crear_reserva(personas=5, ingreso=DIA + timedelta(days=3), egreso=DIA + timedelta(days=3))

    datos = _consultar(dias=5).json()

    assert [d["fecha"] for d in datos["dias"]] == [(DIA + timedelta(days=n)).isoformat() for n in range(5)]
    assert [d["ocupados"] for d in datos["dias"]] == [10, 10, 0, 5, 0]
    assert [d["disponibles"] for d in datos["dias"]] == [70, 70, 80, 75, 80]


def test_sin_indicar_los_dias_devuelve_una_semana():
    assert len(client.get(URL, params={"desde": DIA.isoformat()}).json()["dias"]) == 7


def test_se_puede_consultar_cualquier_fecha_no_solo_las_siguientes_a_la_elegida(crear_reserva):
    otra = date(2097, 8, 20)
    crear_reserva(personas=7, ingreso=otra, egreso=otra)

    datos = _consultar(desde=otra).json()

    assert _dia(datos, otra)["ocupados"] == 7
    assert _dia(_consultar().json(), DIA)["ocupados"] == 0


def test_se_puede_consultar_desde_hoy():
    response = _consultar(desde=hoy_argentina())

    assert response.status_code == 200, response.text
    assert response.json()["dias"][0]["fecha"] == hoy_argentina().isoformat()


# --- Es la misma regla de CapacityService ---

def test_cada_dia_coincide_con_lugares_ocupados_de_capacity_service(crear_reserva):
    crear_reserva(personas=4, ingreso=DIA - timedelta(days=2), egreso=DIA + timedelta(days=1))
    crear_reserva(personas=6, ingreso=DIA, egreso=DIA)
    crear_reserva(personas=9, ingreso=DIA + timedelta(days=2), egreso=DIA + timedelta(days=4))
    crear_reserva(personas=20, estado=EstadoReservaEnum.CANCELADA)

    datos = _consultar(dias=6).json()

    db = SessionLocal()
    try:
        for dia in datos["dias"]:
            fecha = date.fromisoformat(dia["fecha"])
            assert dia["ocupados"] == CapacityService().lugares_ocupados(db, fecha, fecha)
    finally:
        db.close()


def test_el_cupo_maximo_es_el_que_se_vende_por_la_web():
    assert _consultar().json()["cupo_maximo"] == cupo_online(CAPACIDAD, BUFFER)


def test_el_dia_de_egreso_de_una_reserva_tambien_cuenta_como_la_regla_de_la_reserva(crear_reserva):
    crear_reserva(personas=8, ingreso=DIA - timedelta(days=2), egreso=DIA)

    assert _dia(_consultar().json(), DIA)["ocupados"] == 8


# --- Canceladas, pendientes y vencidas, como en la reserva ---

def test_una_reserva_cancelada_no_ocupa_lugar(crear_reserva):
    crear_reserva(personas=10, estado=EstadoReservaEnum.CANCELADA)

    assert _dia(_consultar().json(), DIA)["ocupados"] == 0


def test_una_pendiente_dentro_del_plazo_de_pago_ocupa_lugar(crear_reserva):
    crear_reserva(personas=10, estado=EstadoReservaEnum.PENDIENTE, antiguedad=timedelta(minutes=1))

    assert _dia(_consultar().json(), DIA)["ocupados"] == 10


def test_una_pendiente_vencida_no_ocupa_lugar(crear_reserva):
    crear_reserva(personas=10, estado=EstadoReservaEnum.PENDIENTE, antiguedad=timedelta(days=2))

    assert _dia(_consultar().json(), DIA)["ocupados"] == 0


@pytest.mark.parametrize("estado", [EstadoReservaEnum.CONFIRMADA, EstadoReservaEnum.FINALIZADA])
def test_las_confirmadas_y_finalizadas_ocupan_lugar(crear_reserva, estado):
    crear_reserva(personas=10, estado=estado, antiguedad=timedelta(days=30))

    assert _dia(_consultar().json(), DIA)["ocupados"] == 10


# --- La estadía usa la regla de la reserva ---

def test_la_estadia_usa_la_misma_cuenta_que_valida_la_reserva(crear_reserva):
    # Nunca hay más de 10 personas el mismo día, pero la reserva suma todo lo que toca el rango
    crear_reserva(personas=10, ingreso=DIA, egreso=DIA + timedelta(days=1))
    crear_reserva(personas=10, ingreso=DIA + timedelta(days=2), egreso=DIA + timedelta(days=3))
    egreso = DIA + timedelta(days=3)

    datos = _consultar(dias=4, egreso=egreso.isoformat()).json()

    assert max(d["ocupados"] for d in datos["dias"]) == 10
    assert datos["estadia"] == {
        "ingreso": DIA.isoformat(),
        "egreso": egreso.isoformat(),
        "ocupados": 20,
        "disponibles": CUPO - 20,
        "completo": False,
    }
    db = SessionLocal()
    try:
        assert datos["estadia"]["ocupados"] == CapacityService().lugares_ocupados(db, DIA, egreso)
    finally:
        db.close()


def test_una_estadia_sin_lugares_figura_como_completa(crear_reserva):
    crear_reserva(personas=CUPO, ingreso=DIA + timedelta(days=1), egreso=DIA + timedelta(days=1))

    datos = _consultar(egreso=(DIA + timedelta(days=2)).isoformat()).json()

    assert datos["dias"][0]["completo"] is False
    assert datos["estadia"]["completo"] is True


# --- Público y sin datos personales ---

def test_se_consulta_sin_iniciar_sesion():
    response = client.get(URL, params={"desde": DIA.isoformat()}, headers={})

    assert response.status_code == 200, response.text


def test_la_respuesta_trae_solo_numeros_de_cupo_y_ningun_dato_de_las_reservas(crear_reserva):
    crear_reserva(personas=5)

    response = _consultar(egreso=(DIA + timedelta(days=1)).isoformat())

    datos = response.json()
    assert set(datos) == {"cupo_maximo", "dias", "estadia"}
    assert set(datos["dias"][0]) == {"fecha", "ocupados", "disponibles", "completo"}
    assert set(datos["estadia"]) == {"ingreso", "egreso", "ocupados", "disponibles", "completo"}
    texto = response.text.lower()
    for dato_privado in ("titular secreto", "secreto@privado.com", "titular", "email", "dni", "buffer"):
        assert dato_privado not in texto


def test_no_se_puede_modificar_nada_con_este_endpoint():
    assert client.post(URL, json={}).status_code == 405
    assert client.put(URL, json={}).status_code == 405
    assert client.delete(URL).status_code == 405


# --- Fechas inválidas ---

def test_una_fecha_pasada_se_rechaza():
    ayer = hoy_argentina() - timedelta(days=1)

    response = _consultar(desde=ayer)

    assert response.status_code == 422
    assert "anterior a hoy" in response.json()["detail"]


@pytest.mark.parametrize("dias", [0, -1, 32])
def test_la_cantidad_de_dias_tiene_limites(dias):
    assert _consultar(dias=dias).status_code == 422


def test_una_fecha_mal_escrita_se_rechaza():
    assert client.get(URL, params={"desde": "10/03/2097"}).status_code == 422


def test_sin_la_fecha_se_rechaza():
    assert client.get(URL).status_code == 422


def test_un_egreso_anterior_al_ingreso_se_rechaza():
    response = _consultar(egreso=(DIA - timedelta(days=1)).isoformat())

    assert response.status_code == 422


def test_una_estadia_mas_larga_que_el_maximo_se_rechaza():
    response = _consultar(egreso=(DIA + timedelta(days=60)).isoformat())

    assert response.status_code == 422
    assert "noches" in response.json()["detail"]


# --- El backend sigue validando al reservar ---

def _pedido_de_reserva(dia: date) -> dict:
    return {
        "fecha_ingreso": dia.isoformat(),
        "fecha_egreso": dia.isoformat(),
        "email": "reserva@test.com",
        "personas": [{"nombre": "Ana Prueba", "edad": 30, "condicion": "visitante"}],
    }


def test_un_dia_completo_tambien_se_rechaza_al_crear_la_reserva(crear_reserva):
    crear_reserva(personas=CUPO)
    assert _dia(_consultar().json(), DIA)["completo"] is True

    response = client.post("/reservas/", json=_pedido_de_reserva(DIA))

    assert response.status_code == 400
    assert response.json()["detail"] == "No hay cupos suficientes disponibles en el camping."


def test_con_un_lugar_libre_la_reserva_de_una_persona_se_crea(crear_reserva):
    crear_reserva(personas=CUPO - 1)
    assert _dia(_consultar().json(), DIA)["disponibles"] == 1

    response = client.post("/reservas/", json=_pedido_de_reserva(DIA))

    assert response.status_code == 201, response.text
    # Con esa reserva el día queda completo
    assert _dia(_consultar().json(), DIA)["completo"] is True
    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.id == uuid.UUID(response.json()["id"])).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()
