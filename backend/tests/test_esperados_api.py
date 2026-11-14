import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterator

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from core.config import settings
from core.database import Base, SessionLocal, engine, get_db
from core.dependencies import get_current_user
from main import app
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from services.ocupacion_service import obtener_esperados

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL_ESPERADOS = "/api/v1/admin/esperados"

# Día fijo y lejano: ninguna otra reserva de la base cae en esa fecha, así los conteos
# dependen solo de lo que crea cada test
HOY = date(2098, 3, 17)
AYER = HOY - timedelta(days=1)
MANIANA = HOY + timedelta(days=1)


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se usan tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture(autouse=True)
def hoy_fijo(monkeypatch) -> None:
    """El endpoint calcula el día de hoy; en los tests se fija en HOY."""
    monkeypatch.setattr("services.ocupacion_service.hoy_argentina", lambda: HOY)


def _token(user_id: uuid.UUID) -> str:
    return jwt.encode({"sub": str(user_id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")


def _headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tokens() -> Iterator[Dict[str, str]]:
    """Un usuario por rol. Se borran al terminar el módulo."""
    db = SessionLocal()
    creados: Dict[str, uuid.UUID] = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"esperados_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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

    yield {rol: _token(user_id) for rol, user_id in creados.items()}

    db = SessionLocal()
    try:
        db.query(User).filter(User.id.in_(list(creados.values()))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def db_aislada() -> Iterator[Session]:
    """
    Sesión dentro de una transacción que se deshace al terminar el test: las reservas e
    ingresos que se crean acá no quedan guardados.
    """
    conexion = engine.connect()
    transaccion = conexion.begin()
    sesion = Session(bind=conexion, join_transaction_mode="create_savepoint")

    def _get_db_de_prueba() -> Iterator[Session]:
        yield sesion

    app.dependency_overrides[get_db] = _get_db_de_prueba
    try:
        yield sesion
    finally:
        app.dependency_overrides.pop(get_db, None)
        sesion.close()
        transaccion.rollback()
        conexion.close()


def _reserva(
    db: Session,
    camping_id: str,
    personas: int = 2,
    ingreso: date = HOY,
    egreso: date = HOY,
    estado_reserva: EstadoReservaEnum = EstadoReservaEnum.CONFIRMADA,
    estado_pago: EstadoPagoEnum = EstadoPagoEnum.PAGADO,
) -> Reserva:
    reserva = Reserva(
        camping_id=camping_id,
        fecha_ingreso=ingreso,
        fecha_egreso=egreso,
        cantidad_personas=personas,
        monto_total=10000.0,
        titular="Titular Esperado",
        email="esperado@grupo8.com",
        estado_reserva=estado_reserva,
        estado_pago=estado_pago,
    )
    db.add(reserva)
    db.flush()
    return reserva


def _registrar_ingreso(db: Session, reserva: Reserva) -> None:
    db.add(IngresoFisico(
        jti=str(uuid.uuid4()),
        reserva_id=reserva.id,
        dispositivo_id="dispositivo-test",
        fecha_hora_ingreso=datetime.now(timezone.utc),
        tipo_ingreso=TipoIngresoEnum.WEB,
        sincronizado_offline=True,
        cantidad_personas=reserva.cantidad_personas,
        monto_cobrado=Decimal("0"),
    ))
    db.flush()


def _consultar(token: str) -> Dict[str, int]:
    response = client.get(URL_ESPERADOS, headers=_headers(token))
    assert response.status_code == 200, response.text
    return response.json()


# --- Cálculo ---

def test_sin_reservas_no_se_espera_a_nadie(db_aislada, tokens):
    assert _consultar(tokens["ADMIN"]) == {"reservas": 0, "personas": 0}


def test_una_reserva_pagada_para_hoy_cuenta_como_esperada(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, personas=3)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 1, "personas": 3}


def test_suma_las_personas_de_todas_las_reservas_esperadas(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, personas=3)
    _reserva(db_aislada, camping_de_prueba, personas=4)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 2, "personas": 7}


def test_una_reserva_que_ya_ingreso_no_cuenta(db_aislada, tokens, camping_de_prueba):
    reserva = _reserva(db_aislada, camping_de_prueba, personas=3)
    _reserva(db_aislada, camping_de_prueba, personas=2)
    _registrar_ingreso(db_aislada, reserva)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 1, "personas": 2}


def test_cuando_la_reserva_ingresa_deja_de_contar(db_aislada, tokens, camping_de_prueba):
    reserva = _reserva(db_aislada, camping_de_prueba, personas=3)
    assert _consultar(tokens["ADMIN"]) == {"reservas": 1, "personas": 3}

    _registrar_ingreso(db_aislada, reserva)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 0, "personas": 0}


def test_una_reserva_cancelada_no_cuenta(db_aislada, tokens, camping_de_prueba):
    # Una cancelación con devolución deja el pago como pagado y la reserva como cancelada
    _reserva(db_aislada, camping_de_prueba, estado_reserva=EstadoReservaEnum.CANCELADA)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 0, "personas": 0}


def test_una_reserva_sin_pagar_no_cuenta(db_aislada, tokens, camping_de_prueba):
    _reserva(
        db_aislada,
        camping_de_prueba,
        estado_reserva=EstadoReservaEnum.PENDIENTE,
        estado_pago=EstadoPagoEnum.PENDIENTE,
    )

    assert _consultar(tokens["ADMIN"]) == {"reservas": 0, "personas": 0}


def test_una_estadia_de_varios_dias_que_incluye_hoy_cuenta(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, personas=4, ingreso=AYER, egreso=MANIANA)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 1, "personas": 4}


def test_el_dia_de_egreso_todavia_cuenta(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, personas=2, ingreso=AYER, egreso=HOY)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 1, "personas": 2}


@pytest.mark.parametrize(
    "ingreso, egreso",
    [
        (MANIANA, MANIANA + timedelta(days=2)),  # empieza mañana
        (AYER - timedelta(days=2), AYER),  # terminó ayer
    ],
)
def test_una_estadia_que_no_incluye_hoy_no_cuenta(
    db_aislada, tokens, camping_de_prueba, ingreso, egreso
):
    _reserva(db_aislada, camping_de_prueba, ingreso=ingreso, egreso=egreso)

    assert _consultar(tokens["ADMIN"]) == {"reservas": 0, "personas": 0}


def test_el_servicio_devuelve_lo_mismo_que_el_endpoint(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, personas=5)

    esperados = obtener_esperados(db_aislada, HOY)

    assert (esperados.reservas, esperados.personas) == (1, 5)
    assert _consultar(tokens["ADMIN"]) == {"reservas": 1, "personas": 5}


# --- Día de hoy en Buenos Aires ---

def test_hoy_se_calcula_con_la_hora_de_buenos_aires(monkeypatch):
    # A la 01:30 UTC del 14/11 en Buenos Aires todavía son las 22:30 del 13/11
    class RelojFijo(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 14, 1, 30, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr("schemas.reserva.datetime", RelojFijo)

    assert hoy_argentina() == date(2026, 11, 13)


# --- Permisos ---

def test_sin_token_responde_401(db_aislada):
    assert client.get(URL_ESPERADOS).status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otro_rol_responde_403(db_aislada, tokens, rol):
    assert client.get(URL_ESPERADOS, headers=_headers(tokens[rol])).status_code == 403
