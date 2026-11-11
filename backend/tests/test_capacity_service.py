import uuid
from datetime import date, datetime, timedelta
from typing import Callable, Iterator, List

import pytest
from fastapi import HTTPException
from services.camping_service import buffer_en_personas, cupo_online
from services.capacity_service import CapacityService
from core.config import settings
from core.database import SessionLocal
from models.configuracion import ConfiguracionCamping
from models.reserva import EstadoReservaEnum, Reserva


def _configuracion(capacidad: int = 50, porcentaje_buffer: int = 10) -> ConfiguracionCamping:
    # No se guarda: el servicio solo lee los valores
    return ConfiguracionCamping(capacidad_total=capacidad, porcentaje_buffer_offline=porcentaje_buffer)


def test_check_availability_success():
    servicio = CapacityService()
    # Capacidad (50) - Buffer (10 % = 5) - Activas (10) = 35 disponibles; piden 2
    resultado = servicio.check_availability(
        espacios_solicitados=2, reservas_activas=10, configuracion=_configuracion()
    )

    assert resultado is True


def test_check_availability_no_hay_cupo_lanza_400():
    servicio = CapacityService()
    # Capacidad (50) - Buffer (5) - Activas (10) = 35 disponibles. ¡Pide 40, debe fallar!

    with pytest.raises(HTTPException) as excinfo:
        servicio.check_availability(
            espacios_solicitados=40, reservas_activas=10, configuracion=_configuracion()
        )

    assert excinfo.value.status_code == 400
    assert excinfo.value.detail == "No hay cupos suficientes disponibles en el camping."


def test_check_availability_vende_justo_hasta_el_cupo_online():
    # 45 - 5 (10 % redondeado hacia arriba de 4,5) - 0 = 40
    servicio = CapacityService()
    configuracion = _configuracion(capacidad=45)

    assert servicio.check_availability(40, 0, configuracion) is True
    with pytest.raises(HTTPException):
        servicio.check_availability(41, 0, configuracion)


@pytest.mark.parametrize("capacidad, porcentaje, buffer", [
    (50, 10, 5),     # el valor recomendado equivale a los 5 lugares de antes
    (45, 10, 5),     # 4,5 se redondea hacia arriba
    (125, 10, 13),   # 12,5 también
    (50, 0, 0),
    (50, 100, 50),
    (7, 1, 1),       # cualquier fracción reserva un lugar entero
])
def test_buffer_en_personas_redondea_hacia_arriba(capacidad, porcentaje, buffer):
    assert buffer_en_personas(capacidad, porcentaje) == buffer
    assert cupo_online(capacidad, porcentaje) == capacidad - buffer


# --- Lugares ocupados: canceladas y pendientes abandonadas no cuentan (Issue 13.6) ---

# Fechas lejanas para no mezclarse con reservas reales de la base, y una "hora actual" fija
FECHA = date(2098, 6, 15)
AHORA = datetime(2098, 6, 1, 12, 0, 0)
PLAZO_MINUTOS = 30


@pytest.fixture
def crear_reserva(camping_de_prueba, monkeypatch) -> Iterator[Callable[..., None]]:
    """Crea reservas directo en la BD (con la antigüedad que se pida) y las borra al terminar."""
    monkeypatch.setattr(settings, "RESERVA_PENDIENTE_TTL_MINUTES", PLAZO_MINUTOS)
    creadas: List[uuid.UUID] = []

    def _crear(estado: EstadoReservaEnum, personas: int = 2, antiguedad: timedelta = timedelta(0),
               ingreso: date = FECHA, egreso: date = FECHA) -> None:
        db = SessionLocal()
        try:
            reserva = Reserva(
                camping_id=camping_de_prueba,
                fecha_reserva=AHORA - antiguedad,
                fecha_ingreso=ingreso,
                fecha_egreso=egreso,
                cantidad_personas=personas,
                monto_total=10000.0,
                titular="Titular Cupo",
                email="cupo@test.com",
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


def _ocupados(ingreso: date = FECHA, egreso: date = FECHA) -> int:
    db = SessionLocal()
    try:
        return CapacityService().lugares_ocupados(db, ingreso, egreso, ahora=AHORA)
    finally:
        db.close()


def test_una_reserva_cancelada_no_ocupa_cupo(crear_reserva):
    crear_reserva(EstadoReservaEnum.CANCELADA, personas=4)

    assert _ocupados() == 0


@pytest.mark.parametrize("minutos", [0, 10, 29])
def test_una_pendiente_dentro_del_plazo_ocupa_cupo(crear_reserva, minutos):
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=3, antiguedad=timedelta(minutes=minutos))

    assert _ocupados() == 3


def test_una_pendiente_mas_antigua_que_el_plazo_no_ocupa_cupo(crear_reserva):
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=3, antiguedad=timedelta(minutes=PLAZO_MINUTOS + 1))

    assert _ocupados() == 0


def test_una_pendiente_abandonada_hace_dias_no_ocupa_cupo(crear_reserva):
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=3, antiguedad=timedelta(days=3))

    assert _ocupados() == 0


def test_la_pendiente_justo_en_el_limite_del_plazo_todavia_ocupa(crear_reserva):
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=3, antiguedad=timedelta(minutes=PLAZO_MINUTOS))

    assert _ocupados() == 3


def test_un_segundo_despues_del_limite_la_pendiente_ya_no_ocupa(crear_reserva):
    crear_reserva(
        EstadoReservaEnum.PENDIENTE, personas=3,
        antiguedad=timedelta(minutes=PLAZO_MINUTOS, seconds=1),
    )

    assert _ocupados() == 0


@pytest.mark.parametrize("estado", [
    EstadoReservaEnum.CONFIRMADA,
    EstadoReservaEnum.FINALIZADA,
    EstadoReservaEnum.ALERTA_CLONACION,
])
def test_las_demas_reservas_ocupan_cupo_aunque_sean_viejas(crear_reserva, estado):
    # El plazo es solo para las pendientes: una confirmada no vence por antigüedad
    crear_reserva(estado, personas=3, antiguedad=timedelta(days=10))

    assert _ocupados() == 3


def test_suma_solo_las_reservas_que_ocupan_cupo(crear_reserva):
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=2, antiguedad=timedelta(minutes=5))   # ocupa
    crear_reserva(EstadoReservaEnum.CONFIRMADA, personas=3)                                    # ocupa
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=5, antiguedad=timedelta(hours=2))      # abandonada
    crear_reserva(EstadoReservaEnum.CANCELADA, personas=7)                                     # cancelada

    assert _ocupados() == 5


def test_el_plazo_se_toma_de_la_configuracion(crear_reserva, monkeypatch):
    crear_reserva(EstadoReservaEnum.PENDIENTE, personas=3, antiguedad=timedelta(minutes=10))

    monkeypatch.setattr(settings, "RESERVA_PENDIENTE_TTL_MINUTES", 5)
    assert _ocupados() == 0

    monkeypatch.setattr(settings, "RESERVA_PENDIENTE_TTL_MINUTES", 60)
    assert _ocupados() == 3


def test_solo_cuentan_las_reservas_que_se_solapan_con_las_fechas(crear_reserva):
    crear_reserva(EstadoReservaEnum.CONFIRMADA, personas=3, ingreso=FECHA, egreso=FECHA + timedelta(days=2))

    # El día del ingreso y el del egreso de la reserva existente cuentan; el anterior y el posterior no
    assert _ocupados(FECHA - timedelta(days=1), FECHA - timedelta(days=1)) == 0
    assert _ocupados(FECHA - timedelta(days=1), FECHA) == 3
    assert _ocupados(FECHA + timedelta(days=2), FECHA + timedelta(days=4)) == 3
    assert _ocupados(FECHA + timedelta(days=3), FECHA + timedelta(days=4)) == 0


def test_sin_reservas_en_esas_fechas_no_hay_lugares_ocupados(camping_de_prueba):
    assert _ocupados(date(2098, 8, 1), date(2098, 8, 3)) == 0
