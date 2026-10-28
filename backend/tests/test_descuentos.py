import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.descuento import Descuento
from models.reserva import Reserva
from models.user import RoleEnum, User
from services.pricing_service import PricingService

Base.metadata.create_all(bind=engine)

# La función que lee los descuentos de la base, antes de que los tests la reemplacen
LECTOR_REAL = PricingService._descuentos_activos

client = TestClient(app)

URL = "/admin/descuentos"


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion():
    """Otros módulos de test reemplazan get_current_user para toda la sesión.
    Acá se usan tokens reales, así que se quita el reemplazo mientras corre cada test."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


def _token(user_id) -> str:
    return jwt.encode({"sub": str(user_id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")


@pytest.fixture(scope="module")
def tokens():
    """Un usuario por rol, con su token. Se borran al terminar el módulo."""
    db = SessionLocal()
    ids = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"desc_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre=f"Usuario {rol.name}",
                dni=str(uuid.uuid4().int)[:8],
                rol=rol,
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            ids[rol.name] = usuario.id
    finally:
        db.close()

    yield {rol: _token(user_id) for rol, user_id in ids.items()}

    db = SessionLocal()
    try:
        db.query(User).filter(User.id.in_(list(ids.values()))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(tokens):
    return _headers(tokens["ADMIN"])


@pytest.fixture
def descuentos_creados():
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for descuento_id in ids:
            db.query(Descuento).filter(Descuento.id == uuid.UUID(descuento_id)).delete()
        db.commit()
    finally:
        db.close()


def _payload(**cambios) -> dict:
    """Descuento por edad válido, con un código distinto en cada llamada."""
    payload = {
        "codigo": f"t_{uuid.uuid4().hex[:10]}",
        "nombre": "Descuento de prueba",
        "aplica_a": "edad",
        "porcentaje": 25,
        "edad_min": 0,
        "edad_max": 12,
        "activo": True,
    }
    payload.update(cambios)
    return payload


def _crear(admin, descuentos_creados, **cambios) -> dict:
    response = client.post(URL, json=_payload(**cambios), headers=admin)
    assert response.status_code == 201, response.text
    descuentos_creados.append(response.json()["id"])
    return response.json()


def _buscar(admin, descuento_id: str):
    lista = client.get(URL, headers=admin).json()
    return next((d for d in lista if d["id"] == descuento_id), None)


# ---------- Permisos ----------

PEDIDOS = [
    pytest.param("get", URL, None, id="listar"),
    pytest.param("post", URL, _payload(), id="crear"),
    pytest.param("put", f"{URL}/{uuid.uuid4()}", {"nombre": "Otro nombre"}, id="modificar"),
]


@pytest.mark.parametrize("metodo, url, cuerpo", PEDIDOS)
def test_sin_token_devuelve_401(metodo, url, cuerpo):
    assert client.request(metodo, url, json=cuerpo).status_code == 401


@pytest.mark.parametrize("metodo, url, cuerpo", PEDIDOS)
def test_token_invalido_devuelve_401(metodo, url, cuerpo):
    response = client.request(metodo, url, json=cuerpo, headers=_headers("no-es-un-jwt"))
    assert response.status_code == 401


@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
@pytest.mark.parametrize("metodo, url, cuerpo", PEDIDOS)
def test_roles_que_no_son_admin_reciben_403(rol, metodo, url, cuerpo, tokens):
    response = client.request(metodo, url, json=cuerpo, headers=_headers(tokens[rol]))
    assert response.status_code == 403


def test_un_pedido_rechazado_por_permisos_no_crea_nada(tokens, admin):
    payload = _payload()

    client.post(URL, json=payload, headers=_headers(tokens["CLIENTE"]))

    codigos = [d["codigo"] for d in client.get(URL, headers=admin).json()]
    assert payload["codigo"] not in codigos


def test_admin_puede_listar(admin):
    response = client.get(URL, headers=admin)

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_no_existe_una_ruta_para_borrar_descuentos(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    assert client.delete(f"{URL}/{creado['id']}", headers=admin).status_code == 405
    assert _buscar(admin, creado["id"]) is not None


# ---------- Crear ----------

def test_admin_crea_un_descuento_por_edad(admin, descuentos_creados):
    payload = _payload(porcentaje=33.5)

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 201, response.text
    descuentos_creados.append(response.json()["id"])
    data = response.json()
    assert data["codigo"] == payload["codigo"]
    assert data["nombre"] == "Descuento de prueba"
    assert data["aplica_a"] == "edad"
    assert data["porcentaje"] == 33.5
    assert (data["edad_min"], data["edad_max"]) == (0, 12)
    assert data["activo"] is True


def test_admin_crea_un_descuento_para_socios_sin_edades(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados, aplica_a="socio", edad_min=None, edad_max=None)

    assert creado["aplica_a"] == "socio"
    assert creado["edad_min"] is None and creado["edad_max"] is None


def test_un_descuento_creado_aparece_en_el_listado(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    assert _buscar(admin, creado["id"]) == creado


def test_activo_es_verdadero_si_no_se_envia(admin, descuentos_creados):
    payload = _payload()
    del payload["activo"]

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 201
    descuentos_creados.append(response.json()["id"])
    assert response.json()["activo"] is True


def test_el_codigo_se_recorta_pero_no_se_acepta_con_mayusculas(admin, descuentos_creados):
    codigo = f"t_{uuid.uuid4().hex[:10]}"
    response = client.post(URL, json=_payload(codigo=f"  {codigo}  "), headers=admin)

    assert response.status_code == 201
    descuentos_creados.append(response.json()["id"])
    assert response.json()["codigo"] == codigo


def test_un_codigo_repetido_devuelve_409(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    response = client.post(URL, json=_payload(codigo=creado["codigo"]), headers=admin)

    assert response.status_code == 409


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("porcentaje", -1),
        ("porcentaje", -0.01),
        ("porcentaje", 100.01),
        ("porcentaje", 101),
        ("porcentaje", 10.123),
        ("porcentaje", "10"),
        ("porcentaje", "abc"),
        ("porcentaje", True),
        ("porcentaje", None),
        ("nombre", ""),
        ("nombre", "   "),
        ("nombre", "A"),
        ("nombre", "x" * 101),
        ("nombre", None),
        ("codigo", ""),
        ("codigo", "a"),
        ("codigo", "Menores"),
        ("codigo", "con espacio"),
        ("codigo", "1abc"),
        ("codigo", "a" * 31),
        ("codigo", "ñandu"),
        ("codigo", "a-b"),
        ("codigo", None),
        ("aplica_a", "otro"),
        ("aplica_a", "SOCIO"),
        ("aplica_a", None),
        ("edad_min", -1),
        ("edad_min", 121),
        ("edad_min", 2.5),
        ("edad_min", "5"),
        ("edad_min", True),
        ("edad_max", -1),
        ("edad_max", 121),
        ("edad_max", 2.5),
        ("activo", "quizás"),
        ("id", str(uuid.uuid4())),
    ],
)
def test_crear_rechaza_valores_invalidos_con_422(campo, valor, admin, descuentos_creados):
    response = client.post(URL, json=_payload(**{campo: valor}), headers=admin)

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("campo", ["codigo", "nombre", "aplica_a", "porcentaje"])
def test_crear_sin_campo_obligatorio_devuelve_422(campo, admin):
    payload = _payload()
    del payload[campo]

    assert client.post(URL, json=payload, headers=admin).status_code == 422


@pytest.mark.parametrize(
    "cambios",
    [
        pytest.param({"edad_min": 20, "edad_max": 10}, id="minima_mayor_que_maxima"),
        pytest.param({"edad_min": None, "edad_max": None}, id="por_edad_sin_limites"),
        pytest.param({"edad_min": None}, id="por_edad_sin_minima"),
        pytest.param({"edad_max": None}, id="por_edad_sin_maxima"),
        pytest.param({"aplica_a": "socio"}, id="socio_con_limites_de_edad"),
        pytest.param({"aplica_a": "socio", "edad_min": None}, id="socio_con_una_edad"),
    ],
)
def test_crear_valida_que_las_edades_sean_coherentes(cambios, admin):
    assert client.post(URL, json=_payload(**cambios), headers=admin).status_code == 422


@pytest.mark.parametrize(
    "porcentaje", [0, 100, 12.5, 33.33, 0.01, 99.99]
)
def test_crear_acepta_porcentajes_entre_0_y_100(porcentaje, admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados, porcentaje=porcentaje)

    assert creado["porcentaje"] == pytest.approx(porcentaje)


def test_crear_acepta_edades_en_los_extremos(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados, edad_min=0, edad_max=120)

    assert (creado["edad_min"], creado["edad_max"]) == (0, 120)


# ---------- Modificar ----------

def test_modificar_cambia_nombre_porcentaje_y_estado(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    response = client.put(
        f"{URL}/{creado['id']}",
        json={"nombre": "Menores de 12", "porcentaje": 40, "activo": False},
        headers=admin,
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["nombre"], data["porcentaje"], data["activo"]) == ("Menores de 12", 40, False)
    # lo que no se envió queda igual
    assert data["codigo"] == creado["codigo"]
    assert (data["edad_min"], data["edad_max"]) == (0, 12)
    assert _buscar(admin, creado["id"]) == data


def test_modificar_cambia_los_limites_de_edad(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    response = client.put(
        f"{URL}/{creado['id']}", json={"edad_min": 3, "edad_max": 17}, headers=admin
    )

    assert response.status_code == 200
    assert (response.json()["edad_min"], response.json()["edad_max"]) == (3, 17)


def test_un_descuento_se_puede_desactivar_y_volver_a_activar(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados, aplica_a="socio", edad_min=None, edad_max=None)

    apagado = client.put(f"{URL}/{creado['id']}", json={"activo": False}, headers=admin)
    prendido = client.put(f"{URL}/{creado['id']}", json={"activo": True}, headers=admin)

    assert apagado.json()["activo"] is False
    assert prendido.json()["activo"] is True


@pytest.mark.parametrize("campo, valor", [("codigo", "otro_codigo"), ("aplica_a", "socio"), ("id", str(uuid.uuid4()))])
def test_modificar_no_permite_cambiar_codigo_tipo_ni_id(campo, valor, admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    response = client.put(f"{URL}/{creado['id']}", json={campo: valor}, headers=admin)

    assert response.status_code == 422
    assert _buscar(admin, creado["id"]) == creado


@pytest.mark.parametrize(
    "cuerpo",
    [
        pytest.param({}, id="sin_campos"),
        pytest.param({"porcentaje": -1}, id="porcentaje_negativo"),
        pytest.param({"porcentaje": 100.5}, id="porcentaje_mayor_a_100"),
        pytest.param({"porcentaje": 10.123}, id="porcentaje_con_3_decimales"),
        pytest.param({"porcentaje": "10"}, id="porcentaje_como_texto"),
        pytest.param({"porcentaje": True}, id="porcentaje_booleano"),
        pytest.param({"porcentaje": None}, id="porcentaje_nulo"),
        pytest.param({"nombre": ""}, id="nombre_vacio"),
        pytest.param({"nombre": "x" * 101}, id="nombre_largo"),
        pytest.param({"nombre": None}, id="nombre_nulo"),
        pytest.param({"activo": None}, id="activo_nulo"),
        pytest.param({"activo": "quizás"}, id="activo_invalido"),
        pytest.param({"edad_min": 20}, id="minima_mayor_que_la_maxima_actual"),
        pytest.param({"edad_max": 0, "edad_min": 5}, id="minima_mayor_que_maxima"),
        pytest.param({"edad_min": -1}, id="edad_negativa"),
        pytest.param({"edad_max": 121}, id="edad_mayor_a_120"),
        pytest.param({"edad_min": None}, id="quitar_la_edad_minima"),
    ],
)
def test_modificar_rechaza_valores_invalidos_con_422_y_no_cambia_nada(cuerpo, admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    response = client.put(f"{URL}/{creado['id']}", json=cuerpo, headers=admin)

    assert response.status_code == 422, response.text
    assert _buscar(admin, creado["id"]) == creado


def test_un_descuento_para_socios_no_admite_limites_de_edad(admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados, aplica_a="socio", edad_min=None, edad_max=None)

    response = client.put(f"{URL}/{creado['id']}", json={"edad_min": 5}, headers=admin)

    assert response.status_code == 422
    assert _buscar(admin, creado["id"]) == creado


@pytest.mark.parametrize("porcentaje", [0, 100])
def test_modificar_acepta_los_extremos_del_porcentaje(porcentaje, admin, descuentos_creados):
    creado = _crear(admin, descuentos_creados)

    response = client.put(f"{URL}/{creado['id']}", json={"porcentaje": porcentaje}, headers=admin)

    assert response.status_code == 200
    assert response.json()["porcentaje"] == porcentaje


def test_modificar_un_descuento_inexistente_devuelve_404(admin):
    response = client.put(f"{URL}/{uuid.uuid4()}", json={"nombre": "Otro nombre"}, headers=admin)

    assert response.status_code == 404


def test_modificar_con_un_id_que_no_es_uuid_devuelve_422(admin):
    assert client.put(f"{URL}/no-es-uuid", json={"nombre": "Otro nombre"}, headers=admin).status_code == 422


# ---------- Reservas ya creadas ----------

def test_cambiar_un_descuento_no_altera_los_importes_de_reservas_ya_creadas(
    monkeypatch, tokens, admin, descuentos_creados, camping_de_prueba
):
    # El test mira los importes guardados, no la capacidad: se sube el cupo para no depender de la BD local
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    # Acá los descuentos se leen de la base de verdad, para que lo que cambia el administrador se note
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(LECTOR_REAL))
    fecha = "2096-05-10"
    usuario_id = uuid.UUID(jwt.decode(tokens["CLIENTE"], settings.AUTH_SECRET_KEY, algorithms=["HS256"])["sub"])

    reserva = client.post(
        "/reservas/",
        json={
            "user_id": str(usuario_id),
            "fecha_ingreso": fecha,
            "fecha_egreso": fecha,
            "personas": [
                {"nombre": "Ana Pérez", "edad": 34, "condicion": "socio", "dni": "30111222"},
                {"nombre": "Luis Pérez", "edad": 8, "condicion": "visitante"},
            ],
            "email": "descuentos@test.com",
        },
    )
    assert reserva.status_code == 201, reserva.text
    reserva_id = reserva.json()["id"]

    try:
        def guardado():
            lista = client.get(f"/reservas/?fecha_desde={fecha}&limit=100", headers=admin).json()
            return next(r for r in lista if r["id"] == reserva_id)

        antes = guardado()

        # El administrador cambia los descuentos de todas las formas posibles
        socio = _crear(admin, descuentos_creados, aplica_a="socio", edad_min=None, edad_max=None, porcentaje=10)
        menores = _crear(admin, descuentos_creados, porcentaje=15)
        for descuento, cambios in (
            (socio, {"porcentaje": 90}),
            (socio, {"activo": False}),
            (menores, {"porcentaje": 100, "edad_max": 20}),
            (menores, {"activo": False}),
        ):
            assert client.put(f"{URL}/{descuento['id']}", json=cambios, headers=admin).status_code == 200

        despues = guardado()
        assert despues["monto_total"] == antes["monto_total"]
        assert despues["personas"] == antes["personas"]
        assert [p["precio_final"] for p in despues["personas"]] == [p["precio_final"] for p in antes["personas"]]
    finally:
        db = SessionLocal()
        try:
            db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
            db.commit()
        finally:
            db.close()
