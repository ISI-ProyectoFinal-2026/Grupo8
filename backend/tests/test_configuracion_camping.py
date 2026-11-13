import uuid
from typing import Dict, Iterator

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import Settings, settings
from core.database import SessionLocal
from core.dependencies import get_current_user
from main import app
from models.configuracion import ConfiguracionCamping
from models.user import RoleEnum, User
from services.camping_service import PORCENTAJE_BUFFER_RECOMENDADO, obtener_o_crear_camping

client = TestClient(app)

URL = "/api/v1/admin/configuracion"

VALIDA = {
    "capacidad_total": 80,
    "porcentaje_buffer_offline": 20,
    "max_personas_por_reserva": 6,
    "dias_cancelacion": 3,
    "porcentaje_devolucion": 50,
}


@pytest.fixture(autouse=True)
def restaurar_configuracion(configurar_camping) -> None:
    """Cada test arranca con los valores del .env y al final se vuelven a dejar así."""


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se usan tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture(scope="module")
def headers() -> Iterator[Dict[str, Dict[str, str]]]:
    """Un usuario por rol, con su encabezado de autorización. Se borran al terminar el módulo."""
    db = SessionLocal()
    creados = []
    resultado: Dict[str, Dict[str, str]] = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"configuracion_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre=f"Usuario {rol.name}",
                dni=str(uuid.uuid4().int)[:8],
                rol=rol,
            )
            db.add(usuario)
            db.commit()
            creados.append(usuario.id)
            token = jwt.encode({"sub": str(usuario.id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")
            resultado[rol.name] = {"Authorization": f"Bearer {token}"}
    finally:
        db.close()

    yield resultado

    db = SessionLocal()
    try:
        db.query(User).filter(User.id.in_(creados)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _guardada() -> Dict[str, int]:
    db = SessionLocal()
    try:
        camping = obtener_o_crear_camping(db)
        return {
            "capacidad_total": camping.capacidad_total,
            "porcentaje_buffer_offline": camping.porcentaje_buffer_offline,
            "max_personas_por_reserva": camping.max_personas_por_reserva,
            "dias_cancelacion": camping.dias_cancelacion,
            "porcentaje_devolucion": camping.porcentaje_devolucion,
        }
    finally:
        db.close()


# --- Lectura ---

def test_el_admin_lee_la_configuracion_guardada_y_el_buffer_recomendado(headers):
    response = client.get(URL, headers=headers["ADMIN"])

    assert response.status_code == 200
    assert response.json() == {
        "capacidad_total": settings.CAMPING_TOTAL_CAPACITY,
        "porcentaje_buffer_offline": settings.CAMPING_PORCENTAJE_BUFFER_OFFLINE,
        "max_personas_por_reserva": settings.MAX_PERSONAS_POR_RESERVA,
        "dias_cancelacion": settings.CAMPING_DIAS_CANCELACION,
        "porcentaje_devolucion": settings.CAMPING_PORCENTAJE_DEVOLUCION,
        "porcentaje_buffer_recomendado": PORCENTAJE_BUFFER_RECOMENDADO,
    }


def test_el_buffer_recomendado_es_20_por_ciento():
    # La web vende hasta el 80 % del cupo, como pide el documento del proyecto
    assert PORCENTAJE_BUFFER_RECOMENDADO == 20


def test_el_buffer_por_defecto_es_20_por_ciento():
    # Se mira el valor de config.py, no el del .env de cada máquina
    assert Settings.model_fields["CAMPING_PORCENTAJE_BUFFER_OFFLINE"].default == 20


def test_un_camping_existente_conserva_el_buffer_guardado(configurar_camping):
    configurar_camping(porcentaje_buffer_offline=10)

    # Volver a pedir la configuración no la pisa con el valor por defecto
    assert _guardada()["porcentaje_buffer_offline"] == 10


def test_las_reglas_de_cancelacion_por_defecto_son_1_dia_y_100_por_ciento():
    # Se mira el valor de config.py, no el del .env de cada máquina
    assert Settings.model_fields["CAMPING_DIAS_CANCELACION"].default == 1
    assert Settings.model_fields["CAMPING_PORCENTAJE_DEVOLUCION"].default == 100


def test_un_camping_creado_sin_reglas_de_cancelacion_toma_1_dia_y_100_por_ciento():
    # Es lo que hace la migración con los campings que ya existían
    db = SessionLocal()
    camping = ConfiguracionCamping(
        camping_id=f"CAMP-TEST-{uuid.uuid4()}",
        capacidad_total=50,
        porcentaje_buffer_offline=20,
        max_personas_por_reserva=10,
        precio_base_actual=5000.0,
    )
    try:
        db.add(camping)
        db.commit()
        db.refresh(camping)

        assert camping.dias_cancelacion == 1
        assert camping.porcentaje_devolucion == 100
    finally:
        db.delete(camping)
        db.commit()
        db.close()


def test_un_camping_existente_conserva_las_reglas_de_cancelacion_guardadas(configurar_camping):
    configurar_camping(dias_cancelacion=5, porcentaje_devolucion=30)

    guardada = _guardada()
    assert guardada["dias_cancelacion"] == 5
    assert guardada["porcentaje_devolucion"] == 30


# --- Edición ---

def test_el_admin_edita_la_configuracion_y_queda_guardada(headers):
    response = client.put(URL, json=VALIDA, headers=headers["ADMIN"])

    assert response.status_code == 200
    assert response.json() == {**VALIDA, "porcentaje_buffer_recomendado": PORCENTAJE_BUFFER_RECOMENDADO}
    assert _guardada() == VALIDA
    assert client.get(URL, headers=headers["ADMIN"]).json()["capacidad_total"] == 80


@pytest.mark.parametrize("valores", [
    pytest.param({"capacidad_total": 50, "porcentaje_buffer_offline": 0, "max_personas_por_reserva": 50},
                 id="sin_buffer_el_maximo_puede_ser_toda_la_capacidad"),
    pytest.param({"capacidad_total": 50, "porcentaje_buffer_offline": 10, "max_personas_por_reserva": 45},
                 id="maximo_igual_al_cupo_online"),
    pytest.param({"capacidad_total": 1, "porcentaje_buffer_offline": 0, "max_personas_por_reserva": 1,
                  "dias_cancelacion": 0, "porcentaje_devolucion": 0},
                 id="valores_minimos"),
    pytest.param({"dias_cancelacion": 365, "porcentaje_devolucion": 100},
                 id="plazo_y_devolucion_maximos"),
])
def test_acepta_los_valores_limite(headers, valores):
    cuerpo = {**VALIDA, **valores}
    response = client.put(URL, json=cuerpo, headers=headers["ADMIN"])

    assert response.status_code == 200, response.text
    assert _guardada() == cuerpo


def test_el_backend_usa_el_maximo_editado_al_cotizar(headers):
    client.put(URL, json={**VALIDA, "max_personas_por_reserva": 2}, headers=headers["ADMIN"])

    response = client.post(
        "/reservas/cotizar", json={"personas": [{"edad": 30, "condicion": "visitante"}] * 3}
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "La cantidad máxima de personas por reserva es 2."


def test_el_backend_usa_el_cupo_editado_en_el_monitor_de_ocupacion(headers):
    client.put(URL, json=VALIDA, headers=headers["ADMIN"])

    data = client.get("/api/v1/ocupacion", headers=headers["ADMIN"]).json()

    assert data["capacidad_maxima"] == 80
    assert data["buffer_offline"] == 16  # 20 % de 80


# --- Validación ---

@pytest.mark.parametrize("cambios", [
    pytest.param({"capacidad_total": 0}, id="capacidad_cero"),
    pytest.param({"capacidad_total": -10}, id="capacidad_negativa"),
    pytest.param({"capacidad_total": 10_000_000}, id="capacidad_enorme"),
    pytest.param({"porcentaje_buffer_offline": -1}, id="buffer_negativo"),
    pytest.param({"porcentaje_buffer_offline": 101}, id="buffer_mayor_a_100"),
    pytest.param({"max_personas_por_reserva": 0}, id="maximo_cero"),
    pytest.param({"max_personas_por_reserva": -1}, id="maximo_negativo"),
    pytest.param({"max_personas_por_reserva": 65}, id="maximo_mayor_al_cupo_online"),
    pytest.param({"porcentaje_buffer_offline": 100}, id="buffer_100_no_deja_cupo_online"),
    pytest.param({"capacidad_total": "80"}, id="capacidad_texto"),
    pytest.param({"capacidad_total": 80.5}, id="capacidad_decimal"),
    pytest.param({"porcentaje_buffer_offline": 10.5}, id="buffer_decimal"),
    pytest.param({"max_personas_por_reserva": True}, id="maximo_booleano"),
    pytest.param({"capacidad_total": None}, id="capacidad_nula"),
    pytest.param({"dias_cancelacion": -1}, id="plazo_negativo"),
    pytest.param({"dias_cancelacion": 366}, id="plazo_mayor_a_un_anio"),
    pytest.param({"dias_cancelacion": 1.5}, id="plazo_decimal"),
    pytest.param({"dias_cancelacion": "1"}, id="plazo_texto"),
    pytest.param({"porcentaje_devolucion": -1}, id="devolucion_negativa"),
    pytest.param({"porcentaje_devolucion": 101}, id="devolucion_mayor_a_100"),
    pytest.param({"porcentaje_devolucion": 50.5}, id="devolucion_decimal"),
    pytest.param({"porcentaje_devolucion": None}, id="devolucion_nula"),
])
def test_valores_invalidos_devuelven_422_y_no_cambian_nada(headers, cambios):
    antes = _guardada()

    response = client.put(URL, json={**VALIDA, **cambios}, headers=headers["ADMIN"])

    assert response.status_code == 422
    assert _guardada() == antes


@pytest.mark.parametrize("campo", list(VALIDA))
def test_todos_los_campos_son_obligatorios(headers, campo):
    cuerpo = dict(VALIDA)
    del cuerpo[campo]

    assert client.put(URL, json=cuerpo, headers=headers["ADMIN"]).status_code == 422


def test_el_error_del_maximo_explica_cual_es_el_cupo_online(headers):
    # 80 - 20 % (16) = 64 lugares online
    response = client.put(URL, json={**VALIDA, "max_personas_por_reserva": 65}, headers=headers["ADMIN"])

    assert "64 personas" in response.text


# --- Permisos ---

def test_sin_token_da_401():
    assert client.get(URL).status_code == 401
    assert client.put(URL, json=VALIDA).status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otros_roles_reciben_403_y_no_cambian_nada(headers, rol):
    antes = _guardada()

    assert client.get(URL, headers=headers[rol]).status_code == 403
    assert client.put(URL, json=VALIDA, headers=headers[rol]).status_code == 403
    assert _guardada() == antes
