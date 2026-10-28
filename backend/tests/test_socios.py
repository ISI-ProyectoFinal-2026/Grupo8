import ast
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator, Optional

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient

from core.database import Base, SessionLocal, engine
from main import app
from models.user import User
from schemas.reserva import hoy_argentina
from services.auth_service import usuario_sesion
from services.socio_service import membresia_vigente, validar_socio

Base.metadata.create_all(bind=engine)

client = TestClient(app)

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture
def crear_usuario() -> Iterator:
    """Devuelve una función que crea usuarios con DNI único y los borra al terminar el test."""
    db = SessionLocal()
    creados = []

    def _crear(is_socio: bool = True, vence: Optional[date] = None, estado_cuota: Optional[str] = None,
               nombre: str = "Ana Pérez") -> User:
        usuario = User(
            email=f"socio_{uuid.uuid4()}@grupo8.com",
            password_hash="secreto",
            nombre=nombre,
            dni=str(uuid.uuid4().int)[:8],
            is_socio=is_socio,
            membresia_vence=vence,
            estado_cuota=estado_cuota,
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)
        creados.append(usuario.id)
        return usuario

    yield _crear

    db.query(User).filter(User.id.in_(creados)).delete(synchronize_session=False)
    db.commit()
    db.close()


def _validar(dni: str) -> dict:
    response = client.get(f"/socios/validar/{dni}")
    assert response.status_code == 200
    return response.json()


# --- GET /socios/validar/{dni}: los cuatro casos ---

def test_dni_inexistente_no_es_valido(crear_usuario):
    assert _validar("99999999") == {"valido": False, "motivo": "NO_EXISTE", "nombre": None, "condicion": None}


def test_un_no_socio_no_es_valido(crear_usuario):
    usuario = crear_usuario(is_socio=False, vence=hoy_argentina() + timedelta(days=30))

    assert _validar(usuario.dni) == {"valido": False, "motivo": "NO_ES_SOCIO", "nombre": None, "condicion": None}


def test_un_socio_con_la_cuota_vencida_no_es_valido(crear_usuario):
    usuario = crear_usuario(vence=hoy_argentina() - timedelta(days=1))

    assert _validar(usuario.dni) == {"valido": False, "motivo": "CUOTA_VENCIDA", "nombre": None, "condicion": None}


def test_un_socio_vigente_devuelve_nombre_y_condicion(crear_usuario):
    usuario = crear_usuario(vence=hoy_argentina() + timedelta(days=30), nombre="Emiliana Bianchi")

    assert _validar(usuario.dni) == {
        "valido": True, "motivo": None, "nombre": "Emiliana Bianchi", "condicion": "socio",
    }


# --- Regla de vigencia ---

def test_el_dia_del_vencimiento_todavia_es_valido(crear_usuario):
    usuario = crear_usuario(vence=hoy_argentina())

    assert _validar(usuario.dni)["valido"] is True


def test_el_dia_siguiente_al_vencimiento_ya_no_es_valido(crear_usuario):
    usuario = crear_usuario(vence=hoy_argentina() - timedelta(days=1))

    assert _validar(usuario.dni)["motivo"] == "CUOTA_VENCIDA"


def test_borde_con_fecha_fija(crear_usuario, monkeypatch):
    # Se fija "hoy" para que el test dé lo mismo cualquier día que se ejecute
    monkeypatch.setattr("services.socio_service.hoy_argentina", lambda: date(2026, 6, 15))
    vence_ayer = crear_usuario(vence=date(2026, 6, 14))
    vence_hoy = crear_usuario(vence=date(2026, 6, 15))
    vence_manana = crear_usuario(vence=date(2026, 6, 16))

    assert _validar(vence_ayer.dni)["valido"] is False
    assert _validar(vence_hoy.dni)["valido"] is True
    assert _validar(vence_manana.dni)["valido"] is True


def test_un_socio_sin_fecha_de_vencimiento_figura_como_cuota_vencida(crear_usuario):
    usuario = crear_usuario(vence=None)

    assert _validar(usuario.dni)["motivo"] == "CUOTA_VENCIDA"


def test_estado_cuota_no_decide_nada(crear_usuario):
    activo_pero_vencido = crear_usuario(estado_cuota="Activo", vence=hoy_argentina() - timedelta(days=1))
    inactivo_pero_vigente = crear_usuario(estado_cuota="Inactivo", vence=hoy_argentina() + timedelta(days=1))

    assert _validar(activo_pero_vencido.dni)["valido"] is False
    assert _validar(inactivo_pero_vigente.dni)["valido"] is True


def test_los_espacios_alrededor_del_dni_se_ignoran(crear_usuario):
    usuario = crear_usuario(vence=hoy_argentina())

    assert _validar(f"%20{usuario.dni}%20")["valido"] is True


def test_el_endpoint_es_publico(crear_usuario):
    # Sin token ni cabecera de autorización
    assert client.get("/socios/validar/99999999").status_code == 200


# --- El servicio se puede usar sin la API (Issue 14) ---

def test_validar_socio_como_servicio(crear_usuario):
    usuario = crear_usuario(vence=hoy_argentina())
    db = SessionLocal()
    try:
        assert validar_socio(db, usuario.dni).valido is True
        assert validar_socio(db, "99999999").motivo == "NO_EXISTE"
    finally:
        db.close()


def test_membresia_vigente_usa_la_misma_regla(crear_usuario):
    hoy = hoy_argentina()

    assert membresia_vigente(crear_usuario(vence=hoy), hoy) is True
    assert membresia_vigente(crear_usuario(vence=hoy - timedelta(days=1)), hoy) is False
    assert membresia_vigente(crear_usuario(is_socio=False, vence=hoy), hoy) is False
    assert membresia_vigente(crear_usuario(vence=None), hoy) is False


def test_la_sesion_informa_la_misma_vigencia(crear_usuario):
    vence = hoy_argentina() + timedelta(days=10)
    sesion = usuario_sesion(crear_usuario(vence=vence))

    assert sesion.membresia_vigente is True
    assert sesion.membresia_vence == vence


def test_el_servicio_no_importa_nada_de_api():
    arbol = ast.parse((BACKEND / "services" / "socio_service.py").read_text(encoding="utf-8"))
    importados = []
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.ImportFrom) and nodo.module:
            importados.append(nodo.module)
        elif isinstance(nodo, ast.Import):
            importados.extend(alias.name for alias in nodo.names)

    assert not [m for m in importados if m == "api" or m.startswith("api.")]


# --- Migraciones ---

def test_alembic_tiene_un_solo_head():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))

    assert len(ScriptDirectory.from_config(config).get_heads()) == 1
