import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

import core.tiempo as tiempo
from core.tiempo import a_utc, a_zona_negocio, limites_dias_negocio
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

# ---------- Días de Buenos Aires para filtrar (26.6) ----------

def test_limites_de_un_dia_van_de_medianoche_a_medianoche_argentina():
    inicio, fin = limites_dias_negocio(date(2026, 11, 17), date(2026, 11, 17))

    assert inicio.astimezone(timezone.utc) == datetime(2026, 11, 17, 3, 0, tzinfo=timezone.utc)
    assert fin.astimezone(timezone.utc) == datetime(2026, 11, 18, 3, 0, tzinfo=timezone.utc)


def test_limites_de_un_rango_incluyen_el_ultimo_dia_completo():
    inicio, fin = limites_dias_negocio(date(2026, 11, 1), date(2026, 11, 30))

    assert inicio.astimezone(timezone.utc) == datetime(2026, 11, 1, 3, 0, tzinfo=timezone.utc)
    assert fin.astimezone(timezone.utc) == datetime(2026, 12, 1, 3, 0, tzinfo=timezone.utc)


def test_hoy_negocio_ya_es_el_dia_anterior_a_utc_despues_de_las_21(monkeypatch):
    # 17/11 a las 01:30 UTC son las 22:30 del 16/11 en Buenos Aires
    monkeypatch.setattr(tiempo, "ahora_utc", lambda: datetime(2026, 11, 17, 1, 30, tzinfo=timezone.utc))

    assert tiempo.hoy_negocio() == date(2026, 11, 16)
