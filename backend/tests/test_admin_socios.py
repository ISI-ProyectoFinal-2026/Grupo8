import uuid
from datetime import date, timedelta
from typing import Dict, Iterator

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from schemas.socio import SocioCreate
from services import alta_socio_service
from services.alta_socio_service import SocioDuplicadoError, crear_socio
from services.auth_service import verificar_password

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL = "/admin/socios"
PASSWORD = "inicial123"
PREFIJO_EMAIL = "altasocio_"


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se usan tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


def _token(user_id) -> str:
    return jwt.encode({"sub": str(user_id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")


def _headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _limpiar() -> None:
    db = SessionLocal()
    try:
        db.query(User).filter(User.email.like(f"{PREFIJO_EMAIL}%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture(scope="module")
def tokens() -> Iterator[Dict[str, str]]:
    """Un usuario por rol, con su token. Se borran al terminar el módulo, junto con los socios creados."""
    db = SessionLocal()
    ids = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"{PREFIJO_EMAIL}{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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

    _limpiar()


@pytest.fixture
def admin(tokens) -> Dict[str, str]:
    return _headers(tokens["ADMIN"])


def _payload(**cambios) -> dict:
    payload = {
        "nombre": "Ana Pérez",
        "dni": str(uuid.uuid4().int)[:8],
        "email": f"{PREFIJO_EMAIL}{uuid.uuid4()}@grupo8.com",
        "password": PASSWORD,
        "membresia_vence": (hoy_argentina() + timedelta(days=365)).isoformat(),
    }
    payload.update(cambios)
    return payload


def _usuario_por_dni(dni: str):
    db = SessionLocal()
    try:
        return db.query(User).filter(User.dni == dni).first()
    finally:
        db.close()


def _cantidad_con_dni(dni: str) -> int:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.dni == dni).count()
    finally:
        db.close()


# --- Alta correcta ---

def test_alta_correcta_devuelve_201_y_los_datos_del_socio(admin):
    payload = _payload(membresia_vence="2099-12-31")

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["nombre"] == "Ana Pérez"
    assert body["dni"] == payload["dni"]
    assert body["email"] == payload["email"]
    assert body["membresia_vence"] == "2099-12-31"
    assert body["membresia_vigente"] is True
    assert body["id"]


def test_la_respuesta_nunca_incluye_la_contrasena(admin):
    body = client.post(URL, json=_payload(), headers=admin).json()

    assert set(body) == {"id", "nombre", "dni", "email", "membresia_vence", "membresia_vigente"}
    assert PASSWORD not in str(body)


def test_el_alta_guarda_rol_cliente_socio_y_contrasena_con_hash(admin):
    payload = _payload()

    client.post(URL, json=payload, headers=admin)

    usuario = _usuario_por_dni(payload["dni"])
    assert usuario.rol == RoleEnum.CLIENTE
    assert usuario.is_socio is True
    assert usuario.password_hash != PASSWORD
    assert usuario.password_hash.startswith("$2")
    assert verificar_password(PASSWORD, usuario.password_hash) is True


def test_el_rol_y_la_condicion_del_body_se_ignoran(admin):
    payload = _payload(rol="ADMIN", is_socio=False)

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 201
    usuario = _usuario_por_dni(payload["dni"])
    assert usuario.rol == RoleEnum.CLIENTE
    assert usuario.is_socio is True


def test_el_email_se_guarda_en_minusculas(admin):
    payload = _payload(email=f"{PREFIJO_EMAIL}Mayus_{uuid.uuid4().hex[:8]}@Grupo8.com")

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 201
    assert response.json()["email"] == payload["email"].lower()


def test_los_espacios_alrededor_de_los_datos_se_ignoran(admin):
    payload = _payload(nombre="  Ana Pérez  ")
    payload["dni"] = f" {payload['dni']} "

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 201
    assert response.json()["nombre"] == "Ana Pérez"
    assert response.json()["dni"] == payload["dni"].strip()


def test_los_espacios_de_la_contrasena_se_conservan(admin):
    payload = _payload(password="  con espacios 1  ")
    client.post(URL, json=payload, headers=admin)

    exacta = client.post("/auth/login", json={"identificador": payload["dni"], "password": "  con espacios 1  "})
    recortada = client.post("/auth/login", json={"identificador": payload["dni"], "password": "con espacios 1"})

    assert exacta.status_code == 200
    assert recortada.status_code == 401


def test_el_socio_creado_puede_iniciar_sesion_y_figura_como_vigente(admin):
    payload = _payload()
    client.post(URL, json=payload, headers=admin)

    login = client.post("/auth/login", json={"identificador": payload["dni"], "password": PASSWORD})

    assert login.status_code == 200
    assert login.json()["usuario"]["rol"] == "CLIENTE"
    assert login.json()["usuario"]["membresia_vigente"] is True
    validacion = client.get(f"/socios/validar/{payload['dni']}").json()
    assert validacion["valido"] is True
    assert validacion["nombre"] == "Ana Pérez"


# --- Duplicados ---

def test_un_dni_duplicado_devuelve_409(admin):
    original = _payload()
    client.post(URL, json=original, headers=admin)

    response = client.post(URL, json=_payload(dni=original["dni"]), headers=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "Ya existe un usuario con ese DNI."
    assert _cantidad_con_dni(original["dni"]) == 1


def test_un_email_duplicado_devuelve_409(admin):
    original = _payload()
    client.post(URL, json=original, headers=admin)
    otro = _payload(email=original["email"])

    response = client.post(URL, json=otro, headers=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "Ya existe un usuario con ese email."
    assert _usuario_por_dni(otro["dni"]) is None


def test_un_email_duplicado_con_otras_mayusculas_tambien_devuelve_409(admin):
    original = _payload()
    client.post(URL, json=original, headers=admin)
    otro = _payload(email=original["email"].upper())

    response = client.post(URL, json=otro, headers=admin)

    assert response.status_code == 409
    assert _usuario_por_dni(otro["dni"]) is None


def test_si_otro_pedido_crea_el_mismo_dni_justo_antes_tambien_es_409(admin, monkeypatch):
    # Simula la carrera: la comprobación previa no ve al duplicado, pero la base lo frena al guardar
    original = _payload()
    client.post(URL, json=original, headers=admin)
    real = alta_socio_service._campo_duplicado
    llamadas = []

    def primera_vez_no_ve_nada(db, dni, email):
        llamadas.append(1)
        return None if len(llamadas) == 1 else real(db, dni, email)

    monkeypatch.setattr(alta_socio_service, "_campo_duplicado", primera_vez_no_ve_nada)

    response = client.post(URL, json=_payload(dni=original["dni"]), headers=admin)

    assert response.status_code == 409
    assert _cantidad_con_dni(original["dni"]) == 1


def test_el_servicio_lanza_socio_duplicado_error(admin):
    original = _payload()
    client.post(URL, json=original, headers=admin)
    db = SessionLocal()
    try:
        with pytest.raises(SocioDuplicadoError) as error:
            crear_socio(db, SocioCreate(**_payload(dni=original["dni"])))
        assert error.value.campo == "dni"
    finally:
        db.close()


# --- Validaciones ---

@pytest.mark.parametrize(
    "cambios",
    [
        {"dni": "123456"},             # 6 dígitos
        {"dni": "123456789"},          # 9 dígitos
        {"dni": "12.345.678"},         # con puntos
        {"dni": "1234567a"},           # con letras
        {"dni": ""},
        {"email": "no-es-un-email"},
        {"email": "ana@"},
        {"email": ""},
        {"password": "1234567"},       # 7 caracteres
        {"password": ""},
        {"password": "x" * 73},        # más de 72 bytes (límite de bcrypt)
        {"nombre": "A"},
        {"nombre": "Ana 123"},
        {"nombre": ""},
        {"membresia_vence": "no-es-una-fecha"},
        {"membresia_vence": "2026-02-30"},
        {"membresia_vence": None},
    ],
)
def test_datos_invalidos_devuelven_422_y_no_crean_nada(admin, cambios):
    payload = _payload(**cambios)

    response = client.post(URL, json=payload, headers=admin)

    assert response.status_code == 422
    assert _usuario_por_dni(payload["dni"]) is None


@pytest.mark.parametrize("campo", ["nombre", "dni", "email", "password", "membresia_vence"])
def test_todos_los_campos_son_obligatorios(admin, campo):
    payload = _payload()
    del payload[campo]

    assert client.post(URL, json=payload, headers=admin).status_code == 422


@pytest.mark.parametrize("largo", [7, 8])
def test_dni_de_7_y_de_8_digitos_son_validos(admin, largo):
    response = client.post(URL, json=_payload(dni=str(uuid.uuid4().int)[:largo]), headers=admin)

    assert response.status_code == 201, response.text


# --- Permisos ---

def test_sin_token_da_401():
    assert client.post(URL, json=_payload()).status_code == 401
    assert client.get(URL).status_code == 401


@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
def test_los_demas_roles_reciben_403_y_no_se_crea_nada(tokens, rol):
    payload = _payload()

    assert client.post(URL, json=payload, headers=_headers(tokens[rol])).status_code == 403
    assert client.get(URL, headers=_headers(tokens[rol])).status_code == 403
    assert _usuario_por_dni(payload["dni"]) is None


def test_el_administrador_puede_listar(admin):
    assert client.get(URL, headers=admin).status_code == 200


# --- Listado ---

def test_el_listado_incluye_socios_vigentes_y_vencidos_y_no_a_los_demas(admin):
    vigente = _payload(nombre="Zeta Vigente")
    vencido = _payload(nombre="Alfa Vencido", membresia_vence=(date.today() - timedelta(days=400)).isoformat())
    client.post(URL, json=vigente, headers=admin)
    client.post(URL, json=vencido, headers=admin)

    response = client.get(URL, headers=admin)

    assert response.status_code == 200
    por_dni = {s["dni"]: s for s in response.json()}
    assert por_dni[vigente["dni"]]["membresia_vigente"] is True
    assert por_dni[vencido["dni"]]["membresia_vigente"] is False
    # Los usuarios que no son socios (admin, guardia, cliente) no aparecen
    assert all(s["nombre"] not in ("Usuario ADMIN", "Usuario SEGURIDAD", "Usuario CLIENTE") for s in response.json())


def test_el_listado_va_ordenado_por_nombre(admin):
    zeta = _payload(nombre="Zzz Ultimo")
    alfa = _payload(nombre="Aaa Primero")
    client.post(URL, json=zeta, headers=admin)
    client.post(URL, json=alfa, headers=admin)

    dnis = [s["dni"] for s in client.get(URL, headers=admin).json()]

    assert dnis.index(alfa["dni"]) < dnis.index(zeta["dni"])


def test_el_listado_no_expone_contrasenas(admin):
    client.post(URL, json=_payload(), headers=admin)

    for socio in client.get(URL, headers=admin).json():
        assert set(socio) == {"id", "nombre", "dni", "email", "membresia_vence", "membresia_vigente"}
