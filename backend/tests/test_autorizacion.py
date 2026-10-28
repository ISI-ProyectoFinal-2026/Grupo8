import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterator, Optional

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user, get_current_user_optional, require_role
from main import app
from models.user import RoleEnum, User

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Rutas reales que ya están restringidas al administrador
RUTAS_ADMIN = ["/reservas/", "/admin/descuentos", "/admin/alertas-clonacion"]

# App mínima para probar las dependencias sin depender de ninguna ruta del proyecto
app_prueba = FastAPI()


@app_prueba.get("/admin-o-guardia")
def _admin_o_guardia(usuario: User = Depends(require_role(RoleEnum.ADMIN, RoleEnum.SEGURIDAD))):
    return {"rol": usuario.rol.name}


@app_prueba.get("/solo-admin")
def _solo_admin(usuario: User = Depends(require_role(RoleEnum.ADMIN))):
    return {"rol": usuario.rol.name}


@app_prueba.get("/opcional")
def _opcional(usuario: Optional[User] = Depends(get_current_user_optional)):
    return {"id": str(usuario.id) if usuario else None}


client_prueba = TestClient(app_prueba)


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se prueban tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


def _token(user_id, algoritmo: str = "HS256", **claims) -> str:
    return jwt.encode({"sub": str(user_id), **claims}, settings.AUTH_SECRET_KEY, algorithm=algoritmo)


def _headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def ids() -> Iterator[Dict[str, uuid.UUID]]:
    """Un usuario por rol. Se borran al terminar el módulo."""
    db = SessionLocal()
    creados: Dict[str, uuid.UUID] = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"autz_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre=f"Usuario {rol.name}",
                dni=str(uuid.uuid4().int)[:8],
                rol=rol,
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            creados[rol.name] = usuario.id
    finally:
        db.close()

    yield creados

    db = SessionLocal()
    try:
        db.query(User).filter(User.id.in_(list(creados.values()))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


# --- Rutas de administrador: 401, 403 y 200 ---

@pytest.mark.parametrize("ruta", RUTAS_ADMIN)
def test_sin_token_da_401(ruta):
    assert client.get(ruta).status_code == 401


@pytest.mark.parametrize("ruta", RUTAS_ADMIN)
@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
def test_rol_incorrecto_da_403(ruta, rol, ids):
    assert client.get(ruta, headers=_headers(_token(ids[rol]))).status_code == 403


@pytest.mark.parametrize("ruta", RUTAS_ADMIN)
def test_administrador_da_200(ruta, ids):
    assert client.get(ruta, headers=_headers(_token(ids["ADMIN"]))).status_code == 200


# --- require_role con uno o varios roles ---

@pytest.mark.parametrize("rol", ["ADMIN", "SEGURIDAD"])
def test_require_role_con_varios_roles_deja_pasar_a_cada_uno(rol, ids):
    response = client_prueba.get("/admin-o-guardia", headers=_headers(_token(ids[rol])))

    assert response.status_code == 200
    assert response.json() == {"rol": rol}


def test_require_role_con_varios_roles_rechaza_a_los_demas(ids):
    response = client_prueba.get("/admin-o-guardia", headers=_headers(_token(ids["CLIENTE"])))

    assert response.status_code == 403


def test_require_role_con_un_solo_rol_sigue_funcionando(ids):
    assert client_prueba.get("/solo-admin", headers=_headers(_token(ids["ADMIN"]))).status_code == 200
    assert client_prueba.get("/solo-admin", headers=_headers(_token(ids["SEGURIDAD"]))).status_code == 403


def test_require_role_sin_roles_es_un_error_de_programacion():
    with pytest.raises(ValueError):
        require_role()


# --- El rol sale de la base, no del token ---

def test_el_claim_de_rol_del_token_no_da_permisos(ids):
    # El token dice ADMIN, pero en la base es un socio
    token = _token(ids["CLIENTE"], rol="ADMIN")

    assert client.get("/reservas/", headers=_headers(token)).status_code == 403


def test_el_claim_de_rol_del_token_no_quita_permisos(ids):
    # El token dice CLIENTE, pero en la base es administrador
    token = _token(ids["ADMIN"], rol="CLIENTE")

    assert client.get("/reservas/", headers=_headers(token)).status_code == 200


def test_si_el_rol_cambia_en_la_base_se_aplica_en_el_siguiente_request(ids):
    token = _token(ids["SEGURIDAD"], rol="SEGURIDAD")
    assert client_prueba.get("/solo-admin", headers=_headers(token)).status_code == 403

    db = SessionLocal()
    try:
        db.query(User).filter(User.id == ids["SEGURIDAD"]).update({"rol": RoleEnum.ADMIN})
        db.commit()
        # Mismo token, rol nuevo en la base
        assert client_prueba.get("/solo-admin", headers=_headers(token)).status_code == 200
    finally:
        db.query(User).filter(User.id == ids["SEGURIDAD"]).update({"rol": RoleEnum.SEGURIDAD})
        db.commit()
        db.close()


# --- get_current_user: solo HS256 y tokens bien formados ---

@pytest.mark.parametrize("algoritmo", ["HS384", "HS512"])
def test_get_current_user_rechaza_otros_algoritmos(algoritmo, ids):
    token = _token(ids["ADMIN"], algoritmo=algoritmo)

    assert client.get("/reservas/", headers=_headers(token)).status_code == 401


def test_get_current_user_rechaza_un_token_sin_firma(ids):
    token = jwt.encode({"sub": str(ids["ADMIN"])}, key=None, algorithm="none")

    assert client.get("/reservas/", headers=_headers(token)).status_code == 401


def test_get_current_user_rechaza_un_token_vencido(ids):
    ahora = datetime.now(timezone.utc)
    token = _token(ids["ADMIN"], iat=ahora - timedelta(hours=2), exp=ahora - timedelta(hours=1))

    assert client.get("/reservas/", headers=_headers(token)).status_code == 401


def test_get_current_user_rechaza_una_firma_incorrecta(ids):
    token = jwt.encode({"sub": str(ids["ADMIN"])}, "otra-clave-distinta-de-32-caracteres!!", algorithm="HS256")

    assert client.get("/reservas/", headers=_headers(token)).status_code == 401


@pytest.mark.parametrize("sub", ["no-es-un-uuid", "123", "", None, 42])
def test_un_sub_invalido_da_401_y_no_500(sub):
    claims = {} if sub is None else {"sub": sub}
    token = jwt.encode(claims, settings.AUTH_SECRET_KEY, algorithm="HS256")

    assert client.get("/reservas/", headers=_headers(token)).status_code == 401


def test_un_usuario_que_ya_no_existe_da_401():
    assert client.get("/reservas/", headers=_headers(_token(uuid.uuid4()))).status_code == 401


# --- get_current_user_optional ---

def test_opcional_sin_token_devuelve_none():
    response = client_prueba.get("/opcional")

    assert response.status_code == 200
    assert response.json() == {"id": None}


def test_opcional_con_token_valido_devuelve_el_usuario(ids):
    response = client_prueba.get("/opcional", headers=_headers(_token(ids["CLIENTE"])))

    assert response.status_code == 200
    assert response.json() == {"id": str(ids["CLIENTE"])}


def test_opcional_con_token_invalido_da_401():
    response = client_prueba.get("/opcional", headers=_headers("no-es-un-jwt"))

    assert response.status_code == 401


def test_opcional_con_token_vencido_da_401(ids):
    ahora = datetime.now(timezone.utc)
    token = _token(ids["CLIENTE"], iat=ahora - timedelta(hours=2), exp=ahora - timedelta(hours=1))

    assert client_prueba.get("/opcional", headers=_headers(token)).status_code == 401


def test_opcional_rechaza_otros_algoritmos(ids):
    token = _token(ids["CLIENTE"], algoritmo="HS512")

    assert client_prueba.get("/opcional", headers=_headers(token)).status_code == 401
