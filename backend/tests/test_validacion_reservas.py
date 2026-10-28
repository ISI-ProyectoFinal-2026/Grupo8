import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from core.config import settings
from main import app
from schemas.reserva import ReservaCreate, hoy_argentina

client = TestClient(app)


def _persona(**cambios) -> dict:
    persona = {"nombre": "Ana Pérez", "edad": 34, "condicion": "visitante"}
    persona.update(cambios)
    return persona


def _payload(**cambios) -> dict:
    manana = (hoy_argentina() + timedelta(days=1)).isoformat()
    payload = {
        "fecha_ingreso": manana,
        "fecha_egreso": manana,
        "personas": [_persona(), _persona(nombre="Luis Pérez", edad=8)],
        "email": "ana@test.com",
    }
    payload.update(cambios)
    return payload


AYER = (hoy_argentina() - timedelta(days=1)).isoformat()

CASOS_INVALIDOS = [
    ("email", ""),
    ("email", "no-es-un-email"),
    ("email", "ana@test"),
    ("email", "ana perez@test.com"),
    ("email", "ana@@test.com"),
    ("fecha_ingreso", ""),
    ("fecha_ingreso", "20-12-2030"),
    ("fecha_ingreso", "2030-02-30"),
    ("fecha_ingreso", "mañana"),
    ("fecha_ingreso", 20301220),
    ("fecha_ingreso", AYER),
    ("fecha_egreso", AYER),
]


# Listas de personas inválidas: cada caso es el valor completo del campo "personas"
PERSONAS_INVALIDAS = [
    pytest.param([], id="lista_vacia"),
    pytest.param(None, id="sin_lista"),
    pytest.param("Ana Pérez", id="no_es_lista"),
    pytest.param([_persona()] * 1 + [_persona(nombre="Persona Extra")] * settings.MAX_PERSONAS_POR_RESERVA,
                 id="mas_del_maximo"),
    pytest.param([_persona(nombre="")], id="nombre_vacio"),
    pytest.param([_persona(nombre="   ")], id="nombre_en_blanco"),
    pytest.param([_persona(nombre="A")], id="nombre_corto"),
    pytest.param([_persona(nombre="12345")], id="nombre_con_numeros"),
    pytest.param([_persona(nombre="Ana<script>")], id="nombre_con_simbolos"),
    pytest.param([_persona(nombre="x" * 101)], id="nombre_largo"),
    pytest.param([_persona(nombre=None)], id="nombre_nulo"),
    pytest.param([_persona(edad=-1)], id="edad_negativa"),
    pytest.param([_persona(edad=121)], id="edad_mayor_al_maximo"),
    pytest.param([_persona(edad=2.5)], id="edad_decimal"),
    pytest.param([_persona(edad="34")], id="edad_texto"),
    pytest.param([_persona(edad=True)], id="edad_booleana"),
    pytest.param([_persona(edad=None)], id="edad_nula"),
    pytest.param([_persona(condicion="invitado")], id="condicion_desconocida"),
    pytest.param([_persona(condicion=None)], id="condicion_nula"),
    pytest.param([_persona(condicion="socio")], id="socio_sin_dni"),
    pytest.param([_persona(condicion="socio", dni="")], id="socio_con_dni_vacio"),
    pytest.param([_persona(condicion="socio", dni="123456")], id="dni_de_6_digitos"),
    pytest.param([_persona(condicion="socio", dni="123456789")], id="dni_de_9_digitos"),
    pytest.param([_persona(condicion="socio", dni="12.345.678")], id="dni_con_puntos"),
    pytest.param([_persona(condicion="socio", dni="1234567a")], id="dni_con_letras"),
    pytest.param([_persona(condicion="visitante", dni="abc")], id="visitante_con_dni_invalido"),
    pytest.param(
        [_persona(condicion="socio", dni="12345678"), _persona(nombre="Luis Pérez", condicion="socio", dni="12345678")],
        id="dni_repetido",
    ),
]


@pytest.mark.parametrize("personas", PERSONAS_INVALIDAS)
def test_schema_rechaza_personas_invalidas(personas):
    with pytest.raises(ValidationError):
        ReservaCreate(**_payload(personas=personas))


@pytest.mark.parametrize("personas", PERSONAS_INVALIDAS)
def test_api_rechaza_personas_invalidas_con_422(personas):
    response = client.post("/reservas/", json=_payload(personas=personas))
    assert response.status_code == 422


@pytest.mark.parametrize("campo, valor", CASOS_INVALIDOS)
def test_schema_rechaza_valores_invalidos(campo, valor):
    with pytest.raises(ValidationError):
        ReservaCreate(**_payload(**{campo: valor}))


@pytest.mark.parametrize("campo, valor", CASOS_INVALIDOS)
def test_api_rechaza_valores_invalidos_con_422(campo, valor):
    response = client.post("/reservas/", json=_payload(**{campo: valor}))
    assert response.status_code == 422


@pytest.mark.parametrize(
    "campo", ["fecha_ingreso", "fecha_egreso", "personas", "email"]
)
def test_api_rechaza_campos_obligatorios_ausentes(campo):
    payload = _payload()
    del payload[campo]
    assert client.post("/reservas/", json=payload).status_code == 422


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("email", "ana.perez+camping@correo.com.ar"),
        ("fecha_ingreso", hoy_argentina().isoformat()),  # hoy es válido
    ],
)
def test_schema_acepta_valores_validos(campo, valor):
    reserva = ReservaCreate(**_payload(**{campo: valor}))
    assert getattr(reserva, campo) is not None


PERSONAS_VALIDAS = [
    pytest.param([_persona()], id="una_persona"),
    pytest.param([_persona(nombre=f"Persona {chr(65 + i)}") for i in range(settings.MAX_PERSONAS_POR_RESERVA)],
                 id="maximo_de_personas"),
    pytest.param([_persona(nombre="José María O'Brien-Núñez")], id="nombre_con_acentos_y_apostrofe"),
    pytest.param([_persona(nombre="J. R. Smith")], id="nombre_con_puntos"),
    pytest.param([_persona(edad=0)], id="edad_minima"),
    pytest.param([_persona(edad=120)], id="edad_maxima"),
    pytest.param([_persona(condicion="socio", dni="1234567")], id="socio_con_dni_de_7"),
    pytest.param([_persona(condicion="socio", dni="12345678")], id="socio_con_dni_de_8"),
    pytest.param([_persona(condicion="visitante", dni="12345678")], id="visitante_con_dni"),
    pytest.param([_persona(condicion="visitante", dni="")], id="visitante_con_dni_vacio"),
    pytest.param(
        [_persona(condicion="socio", dni="12345678"), _persona(nombre="Luis Pérez", condicion="visitante")],
        id="reserva_mixta",
    ),
]


@pytest.mark.parametrize("personas", PERSONAS_VALIDAS)
def test_schema_acepta_personas_validas(personas):
    reserva = ReservaCreate(**_payload(personas=personas))
    assert len(reserva.personas) == len(personas)


def test_schema_recorta_espacios_del_nombre_y_del_dni():
    reserva = ReservaCreate(
        **_payload(personas=[_persona(nombre="  Ana Pérez  ", condicion="socio", dni=" 12345678 ")])
    )
    assert reserva.personas[0].nombre == "Ana Pérez"
    assert reserva.personas[0].dni == "12345678"


def test_schema_trata_el_dni_vacio_de_un_visitante_como_ausente():
    reserva = ReservaCreate(**_payload(personas=[_persona(dni="  ")]))
    assert reserva.personas[0].dni is None


def test_schema_ya_no_pide_telefono():
    payload = _payload()
    assert "telefono" not in payload
    assert not hasattr(ReservaCreate(**payload), "telefono")


@pytest.mark.parametrize("telefono", ["abc", "123", "", "260-412-3456"])
def test_schema_ignora_el_telefono_si_un_cliente_todavia_lo_manda(telefono):
    # Un cliente viejo puede seguir mandándolo: no se valida ni se guarda
    reserva = ReservaCreate(**_payload(telefono=telefono))
    assert not hasattr(reserva, "telefono")


def test_schema_ya_no_pide_cantidad_personas_ni_titular():
    # La cantidad sale de la lista y el titular es la primera persona
    payload = _payload()
    assert "cantidad_personas" not in payload and "titular" not in payload
    assert len(ReservaCreate(**payload).personas) == 2


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