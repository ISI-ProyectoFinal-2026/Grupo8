import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.user import RoleEnum, User
from services.auth_service import hash_password, verificar_password

Base.metadata.create_all(bind=engine)

client = TestClient(app)

PASSWORD = "clave-segura-123"
CREDENCIALES_INVALIDAS = {"detail": "Credenciales inválidas"}


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion():
    """Otros módulos reemplazan get_current_user para toda la sesión; acá se prueban tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture(scope="module")
def usuarios():
    """Un usuario por rol con contraseña real, y uno con un hash malformado."""
    db = SessionLocal()
    creados = {}
    try:
        datos = {
            "CLIENTE": (RoleEnum.CLIENTE, hash_password(PASSWORD)),
            "SEGURIDAD": (RoleEnum.SEGURIDAD, hash_password(PASSWORD)),
            "ADMIN": (RoleEnum.ADMIN, hash_password(PASSWORD)),
            "HASH_MALFORMADO": (RoleEnum.CLIENTE, "!"),
        }
        for clave, (rol, password_hash) in datos.items():
            usuario = User(
                email=f"auth_{clave.lower()}_{uuid.uuid4().hex[:8]}@grupo8.com",
                password_hash=password_hash,
                nombre=f"Usuario {clave}",
                dni=str(uuid.uuid4().int)[:8],
                rol=rol,
                is_socio=(clave == "CLIENTE"),
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            creados[clave] = {"id": usuario.id, "email": usuario.email, "dni": usuario.dni}
    finally:
        db.close()

    yield creados

    db = SessionLocal()
    try:
        ids = [u["id"] for u in creados.values()]
        db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _login(identificador, password=PASSWORD):
    return client.post("/auth/login", json={"identificador": identificador, "password": password})


def _decodificar(token):
    return jwt.decode(token, settings.AUTH_SECRET_KEY, algorithms=["HS256"])


# --- Login correcto ---

def test_login_con_email(usuarios):
    response = _login(usuarios["CLIENTE"]["email"])

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == settings.AUTH_TOKEN_EXPIRE_MINUTES * 60
    assert body["usuario"]["id"] == str(usuarios["CLIENTE"]["id"])
    assert body["usuario"]["rol"] == "CLIENTE"


def test_login_con_dni(usuarios):
    response = _login(usuarios["CLIENTE"]["dni"])

    assert response.status_code == 200
    assert response.json()["usuario"]["dni"] == usuarios["CLIENTE"]["dni"]


def test_login_con_email_en_mayusculas_y_espacios(usuarios):
    response = _login(f"  {usuarios['CLIENTE']['email'].upper()} ")

    assert response.status_code == 200


def test_respuesta_respeta_contrato_de_usuario(usuarios):
    usuario = _login(usuarios["CLIENTE"]["email"]).json()["usuario"]

    assert set(usuario) == {
        "id", "nombre", "email", "dni", "rol", "is_socio", "membresia_vigente", "membresia_vence",
    }
    assert usuario["is_socio"] is True
    # Sin fecha de vencimiento cargada todavía no hay membresía vigente
    assert usuario["membresia_vigente"] is False
    assert usuario["membresia_vence"] is None
    assert "password_hash" not in usuario


def test_token_tiene_los_claims_del_contrato(usuarios):
    token = _login(usuarios["ADMIN"]["email"]).json()["access_token"]

    assert jwt.get_unverified_header(token)["alg"] == "HS256"
    claims = _decodificar(token)
    assert claims["sub"] == str(usuarios["ADMIN"]["id"])
    assert claims["rol"] == "ADMIN"
    assert claims["exp"] - claims["iat"] == settings.AUTH_TOKEN_EXPIRE_MINUTES * 60


def test_token_del_guardia_dura_mas(usuarios):
    body = _login(usuarios["SEGURIDAD"]["email"]).json()
    claims = _decodificar(body["access_token"])

    duracion = settings.GUARD_TOKEN_EXPIRE_HOURS * 3600
    assert claims["rol"] == "SEGURIDAD"
    assert claims["exp"] - claims["iat"] == duracion
    assert body["expires_in"] == duracion


# --- Credenciales inválidas ---

@pytest.mark.parametrize(
    "identificador, password",
    [
        ("no-existe@grupo8.com", PASSWORD),   # email inexistente
        ("99999999999", PASSWORD),            # DNI inexistente
        (None, "otra-clave-123"),             # contraseña incorrecta (se completa abajo)
        (None, "corta"),                      # contraseña de menos de 8 caracteres
        (None, "x" * 100),                    # contraseña de más de 72 bytes
        ("   ", PASSWORD),                    # identificador vacío
    ],
)
def test_credenciales_invalidas_dan_401_sin_revelar_la_causa(usuarios, identificador, password):
    response = _login(identificador or usuarios["CLIENTE"]["email"], password)

    assert response.status_code == 401
    assert response.json() == CREDENCIALES_INVALIDAS


def test_hash_malformado_da_401_sin_excepcion(usuarios):
    response = _login(usuarios["HASH_MALFORMADO"]["email"], "cualquier-clave")

    assert response.status_code == 401
    assert response.json() == CREDENCIALES_INVALIDAS


def test_body_incompleto_da_422():
    response = client.post("/auth/login", json={"identificador": "41234567"})

    assert response.status_code == 422


# --- GET /auth/me ---

def test_me_con_token_valido(usuarios):
    login = _login(usuarios["CLIENTE"]["dni"]).json()

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {login['access_token']}"})

    assert response.status_code == 200
    assert response.json() == login["usuario"]


def test_me_sin_token_da_401():
    assert client.get("/auth/me").status_code == 401


def test_me_con_token_vencido_da_401(usuarios):
    ahora = datetime.now(timezone.utc)
    vencido = jwt.encode(
        {"sub": str(usuarios["CLIENTE"]["id"]), "rol": "CLIENTE",
         "iat": ahora - timedelta(hours=2), "exp": ahora - timedelta(hours=1)},
        settings.AUTH_SECRET_KEY,
        algorithm="HS256",
    )

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {vencido}"})

    assert response.status_code == 401


def test_me_rechaza_algoritmos_distintos_de_hs256(usuarios):
    token = jwt.encode(
        {"sub": str(usuarios["CLIENTE"]["id"])}, settings.AUTH_SECRET_KEY, algorithm="HS512"
    )

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


# --- Hash de contraseñas ---

def test_hash_password_no_guarda_texto_plano():
    password_hash = hash_password(PASSWORD)

    assert password_hash != PASSWORD
    assert password_hash.startswith("$2")
    assert verificar_password(PASSWORD, password_hash) is True
    assert verificar_password("otra-clave-123", password_hash) is False


def test_hash_password_exige_minimo_8_caracteres():
    with pytest.raises(ValueError):
        hash_password("1234567")


def test_hash_password_rechaza_mas_de_72_bytes():
    with pytest.raises(ValueError):
        hash_password("x" * 73)
