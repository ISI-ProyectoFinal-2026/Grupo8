import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from core.tiempo import a_utc, a_zona_negocio
from security.sync_schemas import ingreso_item_adapter


def _item(fecha: str) -> dict:
    return {
        "tipo_ingreso": "QR",
        "jti": "jti-de-prueba",
        "reserva_id": str(uuid.uuid4()),
        "dispositivo_id": "dispositivo-test",
        "fecha_escaneo": fecha,
    }


def test_a_utc_convierte_cualquier_offset_al_mismo_instante():
    desde_buenos_aires = datetime.fromisoformat("2026-10-25T11:30:00-03:00")

    resultado = a_utc(desde_buenos_aires)

    assert resultado == datetime(2026, 10, 25, 14, 30, tzinfo=timezone.utc)
    assert resultado.utcoffset() == timedelta(0)


def test_a_utc_rechaza_fechas_sin_zona():
    with pytest.raises(ValueError):
        a_utc(datetime(2026, 10, 25, 14, 30))


def test_a_zona_negocio_muestra_la_hora_de_buenos_aires():
    hora = a_zona_negocio(datetime(2026, 10, 25, 14, 30, tzinfo=timezone.utc))

    assert (hora.hour, hora.minute) == (11, 30)
    assert hora.utcoffset() == timedelta(hours=-3)


def test_a_zona_negocio_toma_como_utc_una_fecha_sin_zona():
    assert a_zona_negocio(datetime(2026, 10, 25, 14, 30)).hour == 11


def test_el_schema_normaliza_la_fecha_del_escaneo_a_utc():
    item = ingreso_item_adapter.validate_python(_item("2026-10-25T11:30:00-03:00"))

    assert item.fecha_escaneo == datetime(2026, 10, 25, 14, 30, tzinfo=timezone.utc)
    assert item.fecha_escaneo.utcoffset() == timedelta(0)


def test_el_schema_rechaza_la_fecha_sin_zona():
    with pytest.raises(ValidationError):
        ingreso_item_adapter.validate_python(_item("2026-10-25T14:30:00"))