import uuid
from datetime import date, timedelta
from typing import Callable, Dict, Iterator, List, Optional

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.reserva import Reserva
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services import alta_socio_service
from services.auth_service import hash_password

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL = "/admin/socios"
PASSWORD = "clave-socio-123"
PREFIJO_EMAIL = "gestionsocio_"
CREDENCIALES_INVALIDAS = {"detail": "Credenciales inválidas"}


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


def _dni() -> str:
    return str(uuid.uuid4().int)[:8]


def _email() -> str:
    return f"{PREFIJO_EMAIL}{uuid.uuid4().hex[:12]}@grupo8.com"


@pytest.fixture(scope="module")
def tokens() -> Iterator[Dict[str, str]]:
    """Un usuario por rol, con su token. Al terminar el módulo se borra todo lo creado con el prefijo."""
    db = SessionLocal()
    ids = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(email=_email(), password_hash="secreto", nombre=f"Usuario {rol.name}", dni=_dni(), rol=rol)
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            ids[rol.name] = usuario.id
    finally:
        db.close()

    yield {rol: _token(user_id) for rol, user_id in ids.items()}

    db = SessionLocal()
    try:
        db.query(User).filter(User.email.like(f"{PREFIJO_EMAIL}%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def admin(tokens) -> Dict[str, str]:
    return _headers(tokens["ADMIN"])


@pytest.fixture
def crear_socio(tokens) -> Callable[..., User]:
    """Crea un socio con contraseña real, para poder probar el login."""

    def _crear(vence: Optional[date] = None, activo: bool = True, **campos) -> User:
        db = SessionLocal()
        try:
            datos = {
                "email": _email(),
                "password_hash": hash_password(PASSWORD),
                "nombre": "Ana Pérez",
                "dni": _dni(),
                "rol": RoleEnum.CLIENTE,
                "is_socio": True,
                "membresia_vence": vence if vence is not None else hoy_argentina() + timedelta(days=30),
                "activo": activo,
            }
            datos.update(campos)
            usuario = User(**datos)
            db.add(usuario)
            db.commit()
            db.refresh(usuario)
            return usuario
        finally:
            db.close()

    return _crear


def _leer(user_id) -> Optional[User]:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.id == user_id).first()
    finally:
        db.close()


def _login(identificador: str, password: str = PASSWORD):
    return client.post("/auth/login", json={"identificador": identificador, "password": password})


# --- Migración y modelo ---

def test_la_columna_activo_existe_y_no_admite_nulos():
    columnas = {c["name"]: c for c in inspect(engine).get_columns("usuarios")}
    assert "activo" in columnas
    assert columnas["activo"]["nullable"] is False


def test_un_usuario_nuevo_queda_activo_por_defecto(crear_socio):
    socio = crear_socio()
    assert _leer(socio.id).activo is True


# --- Permisos: solo ADMIN ---

OPERACIONES = [
    ("put", "", {"nombre": "Otro Nombre"}),
    ("post", "/renovar", {"membresia_vence": "2099-12-31"}),
    ("post", "/baja", None),
    ("post", "/reactivar", None),
]


@pytest.mark.parametrize("metodo,sufijo,cuerpo", OPERACIONES)
def test_sin_token_responde_401(metodo, sufijo, cuerpo, crear_socio):
    socio = crear_socio()
    response = client.request(metodo, f"{URL}/{socio.id}{sufijo}", json=cuerpo)
    assert response.status_code == 401


@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
@pytest.mark.parametrize("metodo,sufijo,cuerpo", OPERACIONES)
def test_un_rol_que_no_es_admin_recibe_403(rol, metodo, sufijo, cuerpo, tokens, crear_socio):
    socio = crear_socio()
    response = client.request(metodo, f"{URL}/{socio.id}{sufijo}", json=cuerpo, headers=_headers(tokens[rol]))
    assert response.status_code == 403
    # Nada cambió
    assert _leer(socio.id).nombre == "Ana Pérez"
    assert _leer(socio.id).activo is True


@pytest.mark.parametrize("metodo,sufijo,cuerpo", OPERACIONES)
def test_un_id_inexistente_responde_404(metodo, sufijo, cuerpo, admin):
    response = client.request(metodo, f"{URL}/{uuid.uuid4()}{sufijo}", json=cuerpo, headers=admin)
    assert response.status_code == 404


@pytest.mark.parametrize("metodo,sufijo,cuerpo", OPERACIONES)
def test_un_usuario_que_no_es_socio_no_se_gestiona_desde_aca(metodo, sufijo, cuerpo, admin, crear_socio):
    # Así un administrador no puede darse de baja ni editarse desde el padrón de socios
    no_socio = crear_socio(is_socio=False, rol=RoleEnum.ADMIN)
    response = client.request(metodo, f"{URL}/{no_socio.id}{sufijo}", json=cuerpo, headers=admin)
    assert response.status_code == 404
    assert _leer(no_socio.id).activo is True


# --- Edición ---

def test_editar_cambia_solo_los_campos_enviados(admin, crear_socio):
    socio = crear_socio()

    response = client.put(f"{URL}/{socio.id}", json={"nombre": "  Ana María Pérez "}, headers=admin)

    assert response.status_code == 200
    body = response.json()
    assert body["nombre"] == "Ana María Pérez"
    assert body["dni"] == socio.dni
    assert body["email"] == socio.email
    assert body["membresia_vence"] == socio.membresia_vence.isoformat()
    assert body["activo"] is True
    assert "password" not in body and "password_hash" not in body


def test_editar_dni_y_email(admin, crear_socio):
    socio = crear_socio()
    nuevo_dni = _dni()
    nuevo_email = _email()

    response = client.put(
        f"{URL}/{socio.id}", json={"dni": nuevo_dni, "email": nuevo_email.upper()}, headers=admin
    )

    assert response.status_code == 200
    guardado = _leer(socio.id)
    assert guardado.dni == nuevo_dni
    # El email se guarda en minúsculas, igual que en el alta
    assert guardado.email == nuevo_email.lower()


def test_editar_con_sus_propios_datos_no_es_duplicado(admin, crear_socio):
    socio = crear_socio()
    response = client.put(f"{URL}/{socio.id}", json={"dni": socio.dni, "email": socio.email}, headers=admin)
    assert response.status_code == 200


def test_editar_con_un_dni_de_otro_usuario_responde_409(admin, crear_socio):
    socio = crear_socio()
    otro = crear_socio()

    response = client.put(f"{URL}/{socio.id}", json={"dni": otro.dni}, headers=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "Ya existe un usuario con ese DNI."
    assert _leer(socio.id).dni == socio.dni


def test_editar_con_un_email_de_otro_usuario_responde_409_sin_importar_mayusculas(admin, crear_socio):
    socio = crear_socio()
    otro = crear_socio()

    response = client.put(f"{URL}/{socio.id}", json={"email": otro.email.upper()}, headers=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "Ya existe un usuario con ese email."
    assert _leer(socio.id).email == socio.email


def test_si_otro_pedido_toma_el_dni_justo_antes_responde_409(admin, crear_socio, monkeypatch):
    """La comprobación previa no ve el duplicado; el índice único de la base lo frena igual."""
    socio = crear_socio()
    otro = crear_socio()
    real = alta_socio_service._campo_duplicado
    llamadas: List[int] = []

    def primera_vez_no_ve_nada(*args, **kwargs):
        llamadas.append(1)
        return None if len(llamadas) == 1 else real(*args, **kwargs)

    monkeypatch.setattr(alta_socio_service, "_campo_duplicado", primera_vez_no_ve_nada)

    response = client.put(f"{URL}/{socio.id}", json={"dni": otro.dni}, headers=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "Ya existe un usuario con ese DNI."
    assert _leer(socio.id).dni == socio.dni


def test_si_la_base_rechaza_sin_saber_por_que_igual_responde_409(admin, crear_socio, monkeypatch):
    socio = crear_socio()
    monkeypatch.setattr(alta_socio_service, "_campo_duplicado", lambda *a, **k: None)

    def commit_que_falla(self):
        raise IntegrityError("UPDATE usuarios", {}, Exception("duplicado"))

    monkeypatch.setattr("sqlalchemy.orm.Session.commit", commit_que_falla)

    response = client.put(f"{URL}/{socio.id}", json={"dni": _dni()}, headers=admin)

    assert response.status_code == 409


@pytest.mark.parametrize(
    "campo,valor",
    [
        ("password", "otra-clave-123"),
        ("membresia_vence", "2099-12-31"),
        ("rol", "ADMIN"),
        ("is_socio", False),
        ("activo", False),
        ("id", str(uuid.uuid4())),
    ],
)
def test_editar_un_campo_no_editable_responde_422(campo, valor, admin, crear_socio):
    socio = crear_socio()

    response = client.put(f"{URL}/{socio.id}", json={"nombre": "Otro Nombre", campo: valor}, headers=admin)

    assert response.status_code == 422
    guardado = _leer(socio.id)
    assert guardado.nombre == "Ana Pérez"
    assert guardado.rol == RoleEnum.CLIENTE
    assert guardado.membresia_vence == socio.membresia_vence


@pytest.mark.parametrize(
    "cambios",
    [
        {"nombre": None},
        {"dni": None},
        {"email": None},
        {"nombre": "A"},
        {"nombre": "Ana 123"},
        {"dni": "12.345.678"},
        {"dni": "123"},
        {"email": "no-es-un-email"},
    ],
)
def test_editar_con_datos_invalidos_responde_422(cambios, admin, crear_socio):
    socio = crear_socio()
    response = client.put(f"{URL}/{socio.id}", json=cambios, headers=admin)
    assert response.status_code == 422
    assert _leer(socio.id).dni == socio.dni


def test_editar_sin_campos_no_cambia_nada(admin, crear_socio):
    socio = crear_socio()
    response = client.put(f"{URL}/{socio.id}", json={}, headers=admin)
    assert response.status_code == 200
    assert response.json()["nombre"] == "Ana Pérez"


# --- Renovación ---

def test_renovar_carga_la_nueva_fecha(admin, crear_socio):
    socio = crear_socio(vence=hoy_argentina() - timedelta(days=10))
    nueva = hoy_argentina() + timedelta(days=365)

    response = client.post(f"{URL}/{socio.id}/renovar", json={"membresia_vence": nueva.isoformat()}, headers=admin)

    assert response.status_code == 200
    assert response.json()["membresia_vence"] == nueva.isoformat()
    assert response.json()["membresia_vigente"] is True
    assert _leer(socio.id).membresia_vence == nueva


def test_renovar_hasta_hoy_se_acepta(admin, crear_socio):
    socio = crear_socio(vence=hoy_argentina() - timedelta(days=1))
    response = client.post(
        f"{URL}/{socio.id}/renovar", json={"membresia_vence": hoy_argentina().isoformat()}, headers=admin
    )
    assert response.status_code == 200
    assert response.json()["membresia_vigente"] is True


def test_renovar_con_una_fecha_pasada_responde_422(admin, crear_socio):
    socio = crear_socio()
    ayer = hoy_argentina() - timedelta(days=1)

    response = client.post(f"{URL}/{socio.id}/renovar", json={"membresia_vence": ayer.isoformat()}, headers=admin)

    assert response.status_code == 422
    assert _leer(socio.id).membresia_vence == socio.membresia_vence


def test_renovar_toma_hoy_segun_la_fecha_de_argentina(admin, crear_socio, monkeypatch):
    socio = crear_socio()
    monkeypatch.setattr("schemas.socio.hoy_argentina", lambda: date(2030, 6, 15))

    pasada = client.post(f"{URL}/{socio.id}/renovar", json={"membresia_vence": "2030-06-14"}, headers=admin)
    mismo_dia = client.post(f"{URL}/{socio.id}/renovar", json={"membresia_vence": "2030-06-15"}, headers=admin)

    assert pasada.status_code == 422
    assert mismo_dia.status_code == 200


@pytest.mark.parametrize(
    "cuerpo",
    [{}, {"membresia_vence": None}, {"membresia_vence": "no-es-fecha"}, {"membresia_vence": "2099-12-31", "activo": True}],
)
def test_renovar_con_datos_invalidos_responde_422(cuerpo, admin, crear_socio):
    socio = crear_socio()
    response = client.post(f"{URL}/{socio.id}/renovar", json=cuerpo, headers=admin)
    assert response.status_code == 422


def test_renovar_no_reactiva_a_un_socio_dado_de_baja(admin, crear_socio):
    socio = crear_socio(activo=False)

    response = client.post(f"{URL}/{socio.id}/renovar", json={"membresia_vence": "2099-12-31"}, headers=admin)

    assert response.status_code == 409
    guardado = _leer(socio.id)
    assert guardado.activo is False
    assert guardado.membresia_vence == socio.membresia_vence


# --- Baja ---

def test_la_baja_desactiva_sin_borrar_el_registro(admin, crear_socio):
    socio = crear_socio()

    response = client.post(f"{URL}/{socio.id}/baja", headers=admin)

    assert response.status_code == 200
    body = response.json()
    assert body["activo"] is False
    assert body["membresia_vigente"] is False
    guardado = _leer(socio.id)
    assert guardado is not None
    assert guardado.activo is False
    # La fecha y los datos se conservan
    assert guardado.membresia_vence == socio.membresia_vence
    assert guardado.is_socio is True


def test_dar_de_baja_dos_veces_responde_409(admin, crear_socio):
    socio = crear_socio(activo=False)
    response = client.post(f"{URL}/{socio.id}/baja", headers=admin)
    assert response.status_code == 409


def test_el_listado_muestra_a_los_dados_de_baja_como_inactivos(admin, crear_socio):
    activo = crear_socio()
    de_baja = crear_socio(activo=False)

    socios = {s["id"]: s for s in client.get(URL, headers=admin).json()}

    assert socios[str(activo.id)]["activo"] is True
    assert socios[str(de_baja.id)]["activo"] is False


def test_un_socio_dado_de_baja_deja_de_validar(admin, crear_socio):
    socio = crear_socio()
    assert client.get(f"/socios/validar/{socio.dni}").json()["valido"] is True

    client.post(f"{URL}/{socio.id}/baja", headers=admin)

    # Se informa igual que alguien que no es socio
    assert client.get(f"/socios/validar/{socio.dni}").json() == {
        "valido": False,
        "motivo": "NO_ES_SOCIO",
        "nombre": None,
        "condicion": None,
    }


def test_un_socio_dado_de_baja_no_puede_iniciar_sesion(admin, crear_socio):
    socio = crear_socio()
    assert _login(socio.email).status_code == 200

    client.post(f"{URL}/{socio.id}/baja", headers=admin)

    for identificador in (socio.email, socio.dni):
        response = _login(identificador)
        assert response.status_code == 401
        # Mismo mensaje que una contraseña incorrecta: no revela que la cuenta existe
        assert response.json() == CREDENCIALES_INVALIDAS


def test_un_dado_de_baja_con_contrasena_incorrecta_recibe_la_misma_respuesta(crear_socio):
    socio = crear_socio(activo=False)
    correcta = _login(socio.email)
    incorrecta = _login(socio.email, "otra-clave-999")
    assert correcta.status_code == incorrecta.status_code == 401
    assert correcta.json() == incorrecta.json() == CREDENCIALES_INVALIDAS


def test_la_sesion_abierta_deja_de_valer_en_la_siguiente_peticion(admin, crear_socio):
    socio = crear_socio()
    token = _login(socio.email).json()["access_token"]
    assert client.get("/auth/me", headers=_headers(token)).status_code == 200

    client.post(f"{URL}/{socio.id}/baja", headers=admin)

    response = client.get("/auth/me", headers=_headers(token))
    assert response.status_code == 401
    assert response.json() == {"detail": "No se pudieron validar las credenciales"}


def test_un_admin_dado_de_baja_pierde_el_acceso_al_panel(crear_socio):
    """La regla está en get_current_user, así que vale para cualquier rol."""
    db = SessionLocal()
    try:
        inactivo = User(
            email=_email(), password_hash="secreto", nombre="Admin Inactivo", dni=_dni(),
            rol=RoleEnum.ADMIN, activo=False,
        )
        db.add(inactivo)
        db.commit()
        db.refresh(inactivo)
    finally:
        db.close()

    response = client.get(URL, headers=_headers(_token(inactivo.id)))

    assert response.status_code == 401


# --- Reactivación ---

def test_reactivar_vuelve_a_habilitar_login_y_validacion(admin, crear_socio):
    socio = crear_socio(activo=False)

    response = client.post(f"{URL}/{socio.id}/reactivar", headers=admin)

    assert response.status_code == 200
    assert response.json()["activo"] is True
    assert response.json()["membresia_vigente"] is True
    assert _login(socio.email).status_code == 200
    assert client.get(f"/socios/validar/{socio.dni}").json()["valido"] is True


def test_reactivar_no_cambia_la_fecha_de_vencimiento(admin, crear_socio):
    vencida = hoy_argentina() - timedelta(days=5)
    socio = crear_socio(vence=vencida, activo=False)

    response = client.post(f"{URL}/{socio.id}/reactivar", headers=admin)

    assert response.status_code == 200
    assert response.json()["membresia_vence"] == vencida.isoformat()
    assert response.json()["membresia_vigente"] is False
    # Activo pero vencido: valida como cuota vencida, no como "no es socio"
    assert client.get(f"/socios/validar/{socio.dni}").json()["motivo"] == "CUOTA_VENCIDA"


def test_reactivar_a_un_socio_activo_responde_409(admin, crear_socio):
    socio = crear_socio()
    response = client.post(f"{URL}/{socio.id}/reactivar", headers=admin)
    assert response.status_code == 409


# --- Reservas: el descuento de socio respeta vencimiento y baja ---

INGRESO = hoy_argentina() + timedelta(days=60)
EGRESO = INGRESO + timedelta(days=1)


@pytest.fixture
def reservas_creadas(monkeypatch) -> Iterator[List[str]]:
    """Sube el cupo (no dependemos de la base local) y borra las reservas que crea cada test."""
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 100_000)
    creadas: List[str] = []
    yield creadas
    db = SessionLocal()
    try:
        for reserva_id in creadas:
            db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).delete()
        db.commit()
    finally:
        db.close()


def _reservar(dni_socio: str, headers: Optional[Dict[str, str]] = None):
    return client.post(
        "/reservas/",
        json={
            "fecha_ingreso": INGRESO.isoformat(),
            "fecha_egreso": EGRESO.isoformat(),
            "personas": [
                {"nombre": "Ana Pérez", "edad": 34, "condicion": "socio", "dni": dni_socio},
                {"nombre": "Luis Pérez", "edad": 8, "condicion": "visitante"},
            ],
            "email": "reserva_socio@grupo8.com",
        },
        headers=headers or {},
    )


@pytest.mark.socios_reales
@pytest.mark.usefixtures("camping_de_prueba")
def test_un_socio_vigente_reserva_con_descuento(crear_socio, reservas_creadas, descuentos_fijos):
    socio = crear_socio()

    response = _reservar(socio.dni)

    assert response.status_code == 201
    reservas_creadas.append(response.json()["id"])
    socia = response.json()["personas"][0]
    assert socia["condicion"] == "socio"
    assert socia["descuento_pct"] == descuentos_fijos


@pytest.mark.socios_reales
@pytest.mark.usefixtures("camping_de_prueba")
@pytest.mark.parametrize(
    "caso,mensaje",
    [
        ("inexistente", "no corresponde a un socio"),
        ("no_socio", "no corresponde a un socio"),
        ("vencido", "tiene la membresía vencida"),
        ("de_baja", "no corresponde a un socio"),
    ],
)
def test_una_persona_que_no_valida_como_socio_no_puede_reservar_como_tal(
    caso, mensaje, crear_socio, reservas_creadas
):
    if caso == "inexistente":
        dni = "99999998"
    elif caso == "no_socio":
        dni = crear_socio(is_socio=False).dni
    elif caso == "vencido":
        dni = crear_socio(vence=hoy_argentina() - timedelta(days=1)).dni
    else:
        dni = crear_socio(activo=False).dni

    response = _reservar(dni)

    if response.status_code == 201:
        reservas_creadas.append(response.json()["id"])
    assert response.status_code == 422
    assert dni in response.json()["detail"]
    assert mensaje in response.json()["detail"]


@pytest.mark.usefixtures("camping_de_prueba")
def test_reservar_con_la_sesion_de_un_dado_de_baja_responde_401(crear_socio, reservas_creadas):
    """La dependencia opcional de usuario también rechaza al inactivo: no lo trata como anónimo."""
    socio = crear_socio(activo=False)

    response = _reservar(_dni(), headers=_headers(_token(socio.id)))

    if response.status_code == 201:
        reservas_creadas.append(response.json()["id"])
    assert response.status_code == 401
