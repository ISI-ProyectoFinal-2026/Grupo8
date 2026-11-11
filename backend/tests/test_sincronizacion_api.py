import uuid
from datetime import date, timedelta
from typing import Callable, Dict, Iterator, List, Set

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL = "/api/v1/sincronizacion/bootstrap"
PREFIJO_EMAIL = "bootstrap_"


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


@pytest.fixture(scope="module")
def tokens() -> Iterator[Dict[str, str]]:
    """Un usuario por rol, con su token. Al terminar se borra todo lo creado con el prefijo."""
    db = SessionLocal()
    ids = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"{PREFIJO_EMAIL}{uuid.uuid4().hex[:12]}@grupo8.com",
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
        db.query(Reserva).filter(Reserva.email.like(f"{PREFIJO_EMAIL}%")).delete(synchronize_session=False)
        db.query(User).filter(User.email.like(f"{PREFIJO_EMAIL}%")).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def guardia(tokens) -> Dict[str, str]:
    return _headers(tokens["SEGURIDAD"])


@pytest.fixture
def crear_reserva(tokens, camping_de_prueba) -> Callable[..., str]:
    """Inserta una reserva y devuelve su id. El email lleva el prefijo para borrarla al final."""

    def _crear(estado: EstadoReservaEnum, egreso: date) -> str:
        db = SessionLocal()
        try:
            reserva = Reserva(
                camping_id=camping_de_prueba,
                fecha_ingreso=egreso - timedelta(days=1),
                fecha_egreso=egreso,
                cantidad_personas=2,
                monto_total=10000.0,
                titular="Ana Pérez",
                email=f"{PREFIJO_EMAIL}{uuid.uuid4().hex[:12]}@grupo8.com",
                estado_reserva=estado,
                estado_pago=EstadoPagoEnum.PENDIENTE,
            )
            db.add(reserva)
            db.commit()
            return str(reserva.id)
        finally:
            db.close()

    return _crear


def _todas_las_paginas(headers: Dict[str, str], limit: int) -> List[List[str]]:
    """Recorre la blacklist página por página, como lo hace la PWA."""
    paginas: List[List[str]] = []
    pagina = 1
    while True:
        response = client.get(URL, params={"page": pagina, "limit": limit}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["pagina_actual"] == pagina
        paginas.append(data["blacklist"])
        if not data["tiene_mas_paginas"]:
            return paginas
        pagina += 1
        assert pagina < 10_000, "la paginación no termina"


def _blacklist_completa(headers: Dict[str, str]) -> Set[str]:
    return {i for pagina in _todas_las_paginas(headers, 1000) for i in pagina}


HOY = hoy_argentina()


# --- Permisos ---

def test_sin_token_responde_401():
    assert client.get(URL).status_code == 401


def test_un_cliente_recibe_403(tokens):
    assert client.get(URL, headers=_headers(tokens["CLIENTE"])).status_code == 403


@pytest.mark.parametrize("rol", ["SEGURIDAD", "ADMIN"])
def test_el_guardia_y_el_admin_pueden_descargarlo(rol, tokens):
    response = client.get(URL, headers=_headers(tokens[rol]))
    assert response.status_code == 200


# --- Forma de la respuesta (lo que ya usaba la PWA) ---

def test_mantiene_la_forma_de_la_respuesta(guardia):
    data = client.get(URL, headers=guardia).json()

    assert set(data) == {"blacklist", "configuracion", "clave_publica", "pagina_actual", "tiene_mas_paginas"}
    # Los valores salen de la configuración del camping (19.1); se prueban en el test de abajo
    assert set(data["configuracion"]) == {"capacidad_maxima", "buffer_seguridad"}
    assert data["pagina_actual"] == 1
    assert isinstance(data["blacklist"], list)
    assert all(isinstance(i, str) for i in data["blacklist"])


def test_ya_no_devuelve_la_lista_fija_de_prueba(guardia):
    blacklist = _blacklist_completa(guardia)
    assert not {"1234", "5678", "9999"} & blacklist


# --- Qué reservas entran ---

def test_incluye_las_canceladas_que_egresan_hoy_o_despues(guardia, crear_reserva):
    hoy = crear_reserva(EstadoReservaEnum.CANCELADA, HOY)
    manana = crear_reserva(EstadoReservaEnum.CANCELADA, HOY + timedelta(days=1))
    en_un_mes = crear_reserva(EstadoReservaEnum.CANCELADA, HOY + timedelta(days=30))

    blacklist = _blacklist_completa(guardia)

    assert {hoy, manana, en_un_mes} <= blacklist


def test_no_incluye_las_canceladas_que_ya_terminaron(guardia, crear_reserva):
    ayer = crear_reserva(EstadoReservaEnum.CANCELADA, HOY - timedelta(days=1))
    hace_un_mes = crear_reserva(EstadoReservaEnum.CANCELADA, HOY - timedelta(days=30))

    blacklist = _blacklist_completa(guardia)

    assert ayer not in blacklist
    assert hace_un_mes not in blacklist


@pytest.mark.parametrize(
    "estado",
    [
        EstadoReservaEnum.PENDIENTE,
        EstadoReservaEnum.CONFIRMADA,
        EstadoReservaEnum.FINALIZADA,
        EstadoReservaEnum.ALERTA_CLONACION,
    ],
)
def test_no_incluye_reservas_que_no_estan_canceladas(estado, guardia, crear_reserva):
    reserva = crear_reserva(estado, HOY + timedelta(days=1))
    assert reserva not in _blacklist_completa(guardia)


def test_hoy_se_toma_con_la_fecha_de_argentina(guardia, crear_reserva, monkeypatch):
    reserva = crear_reserva(EstadoReservaEnum.CANCELADA, date(2031, 3, 10))

    monkeypatch.setattr("services.blacklist_service.hoy_argentina", lambda: date(2031, 3, 10))
    assert reserva in _blacklist_completa(guardia)

    monkeypatch.setattr("services.blacklist_service.hoy_argentina", lambda: date(2031, 3, 11))
    assert reserva not in _blacklist_completa(guardia)


# --- Paginación ---

def test_recorrer_las_paginas_trae_cada_reserva_una_sola_vez(guardia, crear_reserva):
    mias = {crear_reserva(EstadoReservaEnum.CANCELADA, HOY + timedelta(days=d)) for d in range(5)}

    paginas = _todas_las_paginas(guardia, limit=2)
    todas = [i for pagina in paginas for i in pagina]

    assert all(len(pagina) <= 2 for pagina in paginas)
    assert len(todas) == len(set(todas))
    assert mias <= set(todas)
    # El orden es fijo: las páginas no se pisan
    assert todas == sorted(todas)


def test_tiene_mas_paginas_indica_si_falta_alguna(guardia, crear_reserva):
    for d in range(3):
        crear_reserva(EstadoReservaEnum.CANCELADA, HOY + timedelta(days=d))
    total = len(_blacklist_completa(guardia))

    primera = client.get(URL, params={"page": 1, "limit": total - 1}, headers=guardia).json()
    ultima = client.get(URL, params={"page": 2, "limit": total - 1}, headers=guardia).json()
    exacta = client.get(URL, params={"page": 1, "limit": total}, headers=guardia).json()

    assert primera["tiene_mas_paginas"] is True
    assert len(ultima["blacklist"]) == 1 and ultima["tiene_mas_paginas"] is False
    assert len(exacta["blacklist"]) == total and exacta["tiene_mas_paginas"] is False


def test_una_pagina_que_no_existe_viene_vacia(guardia):
    data = client.get(URL, params={"page": 100_000, "limit": 1000}, headers=guardia).json()
    assert data["blacklist"] == []
    assert data["tiene_mas_paginas"] is False


@pytest.mark.parametrize("params", [{"page": 0}, {"page": -1}, {"limit": 0}, {"limit": 1001}, {"limit": "x"}])
def test_rechaza_parametros_de_paginacion_invalidos(params, guardia):
    assert client.get(URL, params=params, headers=guardia).status_code == 422


def test_bootstrap_envia_la_configuracion_guardada(guardia, configurar_camping):
    """La PWA recibe el cupo editado desde el panel y el buffer en personas (10 % de 80 = 8)."""
    configurar_camping(capacidad_total=80, porcentaje_buffer_offline=10)

    response = client.get(URL, params={"page": 1, "limit": 1}, headers=guardia)

    assert response.status_code == 200
    assert response.json()["configuracion"] == {"capacidad_maxima": 80, "buffer_seguridad": 8}
