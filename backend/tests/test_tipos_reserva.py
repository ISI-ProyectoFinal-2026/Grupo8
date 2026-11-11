import importlib.util
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Dict, Iterator, List

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from core.config import settings
from core.database import SessionLocal
from core.dependencies import get_current_user
from main import app
from models.reserva import Reserva
from models.tipo_reserva import TipoReserva
from models.user import RoleEnum, User
from schemas.tipo_reserva import TipoReservaCreate

client = TestClient(app)

URL_ADMIN = "/api/v1/admin/tipos-reserva"
URL_PUBLICA = "/api/v1/tipos-reserva"


def _nombre(base: str = "Tipo") -> str:
    # Nombres únicos para no chocar con los tipos iniciales ni con otras corridas
    return f"{base} {uuid.uuid4().hex[:8]}"


def _por_persona(**cambios) -> dict:
    return {"nombre": _nombre("Parcela"), "precio": 5000, "forma_cobro": "POR_PERSONA", "max_personas": 4, **cambios}


def _por_unidad(**cambios) -> dict:
    return {
        "nombre": _nombre("Cabaña"),
        "precio": 25000,
        "forma_cobro": "POR_UNIDAD",
        "max_personas": 6,
        "cantidad_unidades": 4,
        **cambios,
    }


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
                email=f"tipos_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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


@pytest.fixture
def crear(headers) -> Iterator[Callable[[dict], dict]]:
    """Crea tipos por la API y los borra al terminar (junto con las reservas de prueba que los usen)."""
    ids: List[str] = []

    def _crear(datos: dict) -> dict:
        response = client.post(URL_ADMIN, json=datos, headers=headers["ADMIN"])
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
        return response.json()

    yield _crear

    db = SessionLocal()
    try:
        db.query(Reserva).filter(Reserva.tipo_reserva_id.in_(ids)).delete(synchronize_session=False)
        db.query(TipoReserva).filter(TipoReserva.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _guardado(tipo_id: str) -> TipoReserva:
    db = SessionLocal()
    try:
        return db.query(TipoReserva).filter(TipoReserva.id == tipo_id).one()
    finally:
        db.close()


# --- Alta ---

def test_el_admin_crea_un_tipo_por_persona(crear):
    datos = _por_persona()

    tipo = crear(datos)

    assert tipo["nombre"] == datos["nombre"]
    assert tipo["precio"] == 5000
    assert tipo["forma_cobro"] == "POR_PERSONA"
    assert tipo["max_personas"] == 4
    assert tipo["cantidad_unidades"] is None
    assert tipo["activo"] is True
    assert _guardado(tipo["id"]).nombre == datos["nombre"]


def test_el_admin_crea_un_tipo_por_unidad_con_y_sin_limite_de_unidades(crear):
    con_limite = crear(_por_unidad())
    sin_limite = crear(_por_unidad(cantidad_unidades=None))

    assert con_limite["forma_cobro"] == "POR_UNIDAD"
    assert con_limite["cantidad_unidades"] == 4
    assert sin_limite["cantidad_unidades"] is None


def test_el_precio_admite_dos_decimales(crear):
    assert crear(_por_persona(precio=4999.99))["precio"] == 4999.99


def test_el_nombre_se_guarda_sin_espacios_de_mas(crear):
    nombre = _nombre("Domo")
    assert crear(_por_persona(nombre=f"  {nombre}  "))["nombre"] == nombre


def test_un_nombre_repetido_da_409_sin_distinguir_mayusculas(crear, headers):
    tipo = crear(_por_persona())

    response = client.post(URL_ADMIN, json=_por_persona(nombre=tipo["nombre"].upper()), headers=headers["ADMIN"])

    assert response.status_code == 409
    assert response.json()["detail"] == "Ya existe un tipo de reserva con ese nombre."


@pytest.mark.parametrize("cambios", [
    pytest.param({"nombre": ""}, id="nombre_vacio"),
    pytest.param({"nombre": "A"}, id="nombre_corto"),
    pytest.param({"nombre": "A" * 81}, id="nombre_largo"),
    pytest.param({"precio": 0}, id="precio_cero"),
    pytest.param({"precio": -100}, id="precio_negativo"),
    pytest.param({"precio": 10.555}, id="precio_tres_decimales"),
    pytest.param({"precio": "5000"}, id="precio_texto"),
    pytest.param({"precio": True}, id="precio_booleano"),
    pytest.param({"precio": 1_000_000_000}, id="precio_enorme"),
    pytest.param({"forma_cobro": "POR_NOCHE"}, id="forma_cobro_invalida"),
    pytest.param({"max_personas": 0}, id="max_personas_cero"),
    pytest.param({"max_personas": 2.5}, id="max_personas_decimal"),
    pytest.param({"max_personas": "4"}, id="max_personas_texto"),
    pytest.param({"cantidad_unidades": 3}, id="por_persona_con_unidades"),
    pytest.param({"campo_extra": 1}, id="campo_desconocido"),
])
def test_alta_con_datos_invalidos_da_422(headers, cambios):
    datos = _por_persona(**cambios)

    response = client.post(URL_ADMIN, json=datos, headers=headers["ADMIN"])

    assert response.status_code == 422


@pytest.mark.parametrize("unidades", [0, -1])
def test_un_tipo_por_unidad_necesita_al_menos_una_unidad(headers, unidades):
    response = client.post(URL_ADMIN, json=_por_unidad(cantidad_unidades=unidades), headers=headers["ADMIN"])

    assert response.status_code == 422


@pytest.mark.parametrize("campo", ["nombre", "precio", "forma_cobro", "max_personas"])
def test_los_campos_principales_son_obligatorios(headers, campo):
    datos = _por_persona()
    del datos[campo]

    assert client.post(URL_ADMIN, json=datos, headers=headers["ADMIN"]).status_code == 422


def test_el_maximo_de_personas_no_supera_el_maximo_general(headers, configurar_camping):
    configurar_camping(max_personas_por_reserva=5)

    response = client.post(URL_ADMIN, json=_por_persona(max_personas=6), headers=headers["ADMIN"])

    assert response.status_code == 422
    assert response.json()["detail"] == "El máximo de personas no puede superar el máximo general por reserva (5)."


# --- Edición ---

def test_el_admin_edita_solo_los_campos_enviados(crear, headers):
    tipo = crear(_por_unidad())

    response = client.put(f"{URL_ADMIN}/{tipo['id']}", json={"precio": 30000, "max_personas": 5}, headers=headers["ADMIN"])

    assert response.status_code == 200
    assert response.json() == {**tipo, "precio": 30000, "max_personas": 5}
    assert float(_guardado(tipo["id"]).precio) == 30000


def test_cantidad_unidades_en_null_deja_el_tipo_sin_limite(crear, headers):
    tipo = crear(_por_unidad())

    response = client.put(f"{URL_ADMIN}/{tipo['id']}", json={"cantidad_unidades": None}, headers=headers["ADMIN"])

    assert response.status_code == 200
    assert response.json()["cantidad_unidades"] is None


def test_cambiar_a_por_persona_exige_vaciar_las_unidades(crear, headers):
    tipo = crear(_por_unidad())
    url = f"{URL_ADMIN}/{tipo['id']}"

    con_unidades = client.put(url, json={"forma_cobro": "POR_PERSONA"}, headers=headers["ADMIN"])
    sin_unidades = client.put(url, json={"forma_cobro": "POR_PERSONA", "cantidad_unidades": None}, headers=headers["ADMIN"])

    assert con_unidades.status_code == 422
    assert "no lleva cantidad de unidades" in con_unidades.json()["detail"]
    assert sin_unidades.status_code == 200
    assert sin_unidades.json()["forma_cobro"] == "POR_PERSONA"


def test_editar_con_el_nombre_de_otro_tipo_da_409(crear, headers):
    primero = crear(_por_persona())
    segundo = crear(_por_persona())

    response = client.put(
        f"{URL_ADMIN}/{segundo['id']}", json={"nombre": primero["nombre"].lower()}, headers=headers["ADMIN"]
    )

    assert response.status_code == 409
    assert _guardado(segundo["id"]).nombre == segundo["nombre"]


def test_un_tipo_puede_conservar_su_propio_nombre(crear, headers):
    tipo = crear(_por_persona())

    response = client.put(f"{URL_ADMIN}/{tipo['id']}", json={"nombre": tipo["nombre"]}, headers=headers["ADMIN"])

    assert response.status_code == 200


@pytest.mark.parametrize("cuerpo", [
    pytest.param({}, id="sin_campos"),
    pytest.param({"nombre": None}, id="nombre_nulo"),
    pytest.param({"precio": None}, id="precio_nulo"),
    pytest.param({"forma_cobro": None}, id="forma_cobro_nula"),
    pytest.param({"max_personas": None}, id="max_personas_nulo"),
    pytest.param({"activo": None}, id="activo_nulo"),
    pytest.param({"precio": 0}, id="precio_cero"),
    pytest.param({"cantidad_unidades": 0}, id="unidades_cero"),
])
def test_edicion_invalida_da_422_y_no_cambia_nada(crear, headers, cuerpo):
    tipo = crear(_por_unidad())

    response = client.put(f"{URL_ADMIN}/{tipo['id']}", json=cuerpo, headers=headers["ADMIN"])

    assert response.status_code == 422
    assert float(_guardado(tipo["id"]).precio) == 25000


def test_editar_un_tipo_que_no_existe_da_404(headers):
    response = client.put(f"{URL_ADMIN}/{uuid.uuid4()}", json={"precio": 100}, headers=headers["ADMIN"])

    assert response.status_code == 404


# --- Desactivación ---

def test_desactivar_y_volver_a_activar(crear, headers):
    tipo = crear(_por_persona())
    url = f"{URL_ADMIN}/{tipo['id']}"

    assert client.put(url, json={"activo": False}, headers=headers["ADMIN"]).json()["activo"] is False
    assert _guardado(tipo["id"]).activo is False
    assert client.put(url, json={"activo": True}, headers=headers["ADMIN"]).json()["activo"] is True


def _reserva_con_tipo(tipo_id: str) -> uuid.UUID:
    db = SessionLocal()
    try:
        manana = date.today() + timedelta(days=1)
        reserva = Reserva(
            camping_id=settings.CAMPING_ID,
            tipo_reserva_id=tipo_id,
            fecha_ingreso=manana,
            fecha_egreso=manana,
            cantidad_personas=2,
            monto_total=10000,
            titular="Titular Tipos",
            email="titular.tipos@grupo8.com",
        )
        db.add(reserva)
        db.commit()
        return reserva.id
    finally:
        db.close()


def test_desactivar_un_tipo_no_borra_las_reservas_que_lo_usan(crear, headers, camping_de_prueba):
    tipo = crear(_por_persona())
    reserva_id = _reserva_con_tipo(tipo["id"])

    response = client.put(f"{URL_ADMIN}/{tipo['id']}", json={"activo": False}, headers=headers["ADMIN"])

    assert response.status_code == 200
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == reserva_id).one()
        assert str(reserva.tipo_reserva_id) == tipo["id"]
    finally:
        db.close()


def test_la_base_no_deja_borrar_un_tipo_con_reservas(crear, camping_de_prueba):
    tipo = crear(_por_persona())
    _reserva_con_tipo(tipo["id"])

    db = SessionLocal()
    try:
        with pytest.raises(IntegrityError):
            db.query(TipoReserva).filter(TipoReserva.id == tipo["id"]).delete()
            db.flush()
        db.rollback()
    finally:
        db.close()


def test_no_hay_endpoint_para_borrar(crear, headers):
    tipo = crear(_por_persona())

    response = client.delete(f"{URL_ADMIN}/{tipo['id']}", headers=headers["ADMIN"])

    assert response.status_code == 405


# --- Listados ---

def test_el_listado_publico_muestra_solo_los_activos_y_sin_sesion(crear, headers):
    activo = crear(_por_persona())
    inactivo = crear(_por_persona(activo=False))

    response = client.get(URL_PUBLICA)

    assert response.status_code == 200
    ids = [tipo["id"] for tipo in response.json()]
    assert activo["id"] in ids
    assert inactivo["id"] not in ids
    publicado = next(tipo for tipo in response.json() if tipo["id"] == activo["id"])
    assert "activo" not in publicado
    assert publicado["precio"] == 5000


def test_el_listado_del_admin_incluye_los_desactivados(crear, headers):
    inactivo = crear(_por_persona(activo=False))

    response = client.get(URL_ADMIN, headers=headers["ADMIN"])

    assert response.status_code == 200
    assert inactivo["id"] in [tipo["id"] for tipo in response.json()]


# --- Permisos ---

def test_sin_token_el_abm_da_401(crear):
    tipo = crear(_por_persona())

    assert client.get(URL_ADMIN).status_code == 401
    assert client.post(URL_ADMIN, json=_por_persona()).status_code == 401
    assert client.put(f"{URL_ADMIN}/{tipo['id']}", json={"activo": False}).status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otros_roles_reciben_403_y_no_cambian_nada(crear, headers, rol):
    tipo = crear(_por_persona())

    assert client.get(URL_ADMIN, headers=headers[rol]).status_code == 403
    assert client.post(URL_ADMIN, json=_por_persona(), headers=headers[rol]).status_code == 403
    assert client.put(f"{URL_ADMIN}/{tipo['id']}", json={"activo": False}, headers=headers[rol]).status_code == 403
    assert _guardado(tipo["id"]).activo is True


@pytest.mark.parametrize("rol", ["ADMIN", "SEGURIDAD", "CLIENTE"])
def test_el_listado_publico_responde_a_cualquier_rol(headers, rol):
    assert client.get(URL_PUBLICA, headers=headers[rol]).status_code == 200


# --- Tipos iniciales de la migración ---

def _migracion():
    ruta = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c7e1a4d9b382_tipos_reserva.py"
    spec = importlib.util.spec_from_file_location("migracion_tipos_reserva", ruta)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def test_la_migracion_crea_entrada_general_carpa_y_cabana():
    tipos = {tipo["nombre"]: tipo for tipo in _migracion().TIPOS_INICIALES}

    assert set(tipos) == {"Entrada general", "Carpa", "Cabaña"}
    assert tipos["Entrada general"]["forma_cobro"] == "POR_PERSONA"
    assert tipos["Carpa"]["forma_cobro"] == "POR_PERSONA"
    assert tipos["Cabaña"]["forma_cobro"] == "POR_UNIDAD"
    assert tipos["Cabaña"]["max_personas"] == 6
    assert tipos["Cabaña"]["cantidad_unidades"] == 4


def test_los_tipos_iniciales_cumplen_las_reglas_del_abm():
    for tipo in _migracion().TIPOS_INICIALES:
        TipoReservaCreate(**tipo)
        assert tipo["max_personas"] <= settings.MAX_PERSONAS_POR_RESERVA


def test_la_migracion_sigue_a_la_de_la_19_1():
    assert _migracion().down_revision == "b4d8e2f6a913"
