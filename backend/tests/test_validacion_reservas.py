import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from core.config import settings
from main import app
from schemas.reserva import ReservaCreate, hoy_argentina

client = TestClient(app)


def _payload(**cambios) -> dict:
    manana = (hoy_argentina() + timedelta(days=1)).isoformat()
    payload = {
        "user_id": str(uuid.uuid4()),
        "fecha_ingreso": manana,
        "fecha_egreso": manana,
        "cantidad_personas": 2,
        "titular": "Ana Pérez",
        "email": "ana@test.com",
        "telefono": "2604123456",
    }
    payload.update(cambios)
    return payload


AYER = (hoy_argentina() - timedelta(days=1)).isoformat()

CASOS_INVALIDOS = [
    ("cantidad_personas", 0),
    ("cantidad_personas", -1),
    ("cantidad_personas", 2.5),
    ("cantidad_personas", "2"),
    ("cantidad_personas", "abc"),
    ("cantidad_personas", None),
    ("cantidad_personas", True),
    ("cantidad_personas", settings.MAX_PERSONAS_POR_RESERVA + 1),
    ("titular", ""),
    ("titular", "   "),
    ("titular", "A"),
    ("titular", "12345"),
    ("titular", "Ana<script>"),
    ("titular", "x" * 101),
    ("email", ""),
    ("email", "no-es-un-email"),
    ("email", "ana@test"),
    ("email", "ana perez@test.com"),
    ("email", "ana@@test.com"),
    ("telefono", ""),
    ("telefono", "   "),
    ("telefono", "abc"),
    ("telefono", "123"),
    ("telefono", "1" * 16),
    ("telefono", "26041234a6"),
    ("telefono", "+542604123456"),
    ("telefono", "260-412-3456"),
    ("telefono", "260 412 3456"),
    ("telefono", "(260)4123456"),
    ("fecha_ingreso", ""),
    ("fecha_ingreso", "20-12-2030"),
    ("fecha_ingreso", "2030-02-30"),
    ("fecha_ingreso", "mañana"),
    ("fecha_ingreso", 20301220),
    ("fecha_ingreso", AYER),
    ("fecha_egreso", AYER),
]


@pytest.mark.parametrize("campo, valor", CASOS_INVALIDOS)
def test_schema_rechaza_valores_invalidos(campo, valor):
    with pytest.raises(ValidationError):
        ReservaCreate(**_payload(**{campo: valor}))


@pytest.mark.parametrize("campo, valor", CASOS_INVALIDOS)
def test_api_rechaza_valores_invalidos_con_422(campo, valor):
    response = client.post("/reservas/", json=_payload(**{campo: valor}))
    assert response.status_code == 422


@pytest.mark.parametrize(
    "campo", ["user_id", "fecha_ingreso", "fecha_egreso", "cantidad_personas", "titular", "email", "telefono"]
)
def test_api_rechaza_campos_obligatorios_ausentes(campo):
    payload = _payload()
    del payload[campo]
    assert client.post("/reservas/", json=payload).status_code == 422


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("cantidad_personas", 1),
        ("cantidad_personas", settings.MAX_PERSONAS_POR_RESERVA),
        ("titular", "José María O'Brien-Núñez"),
        ("titular", "J. R. Smith"),
        ("titular", "  Ana Pérez  "),
        ("email", "ana.perez+camping@correo.com.ar"),
        ("telefono", "26041234"),          # 8 dígitos (mínimo)
        ("telefono", "5492604123456"),     # con código de país
        ("telefono", "1" * 15),            # 15 dígitos (máximo)
        ("fecha_ingreso", hoy_argentina().isoformat()),  # hoy es válido
    ],
)
def test_schema_acepta_valores_validos(campo, valor):
    reserva = ReservaCreate(**_payload(**{campo: valor}))
    assert getattr(reserva, campo) is not None


def test_schema_recorta_espacios_del_titular():
    assert ReservaCreate(**_payload(titular="  Ana Pérez  ")).titular == "Ana Pérez"


def test_schema_acepta_ingreso_y_egreso_distintos_dias():
    manana = hoy_argentina() + timedelta(days=1)
    reserva = ReservaCreate(
        **_payload(fecha_ingreso=manana.isoformat(), fecha_egreso=(manana + timedelta(days=2)).isoformat())
    )
    assert reserva.fecha_egreso > reserva.fecha_ingreso

def _manana():
    return hoy_argentina() + timedelta(days=1)


def test_schema_rechaza_estadia_mayor_al_maximo():
    egreso = (_manana() + timedelta(days=settings.MAX_NOCHES_POR_RESERVA + 1)).isoformat()
    with pytest.raises(ValidationError):
        ReservaCreate(**_payload(fecha_egreso=egreso))


def test_api_rechaza_estadia_mayor_al_maximo_con_422():
    egreso = (_manana() + timedelta(days=settings.MAX_NOCHES_POR_RESERVA + 1)).isoformat()
    assert client.post("/reservas/", json=_payload(fecha_egreso=egreso)).status_code == 422


def test_schema_acepta_estadia_en_el_maximo():
    egreso = (_manana() + timedelta(days=settings.MAX_NOCHES_POR_RESERVA)).isoformat()
    assert ReservaCreate(**_payload(fecha_egreso=egreso)).fecha_egreso.isoformat() == egreso