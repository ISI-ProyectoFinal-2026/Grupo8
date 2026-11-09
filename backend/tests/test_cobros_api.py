"""Resumen de cobros en efectivo y con Mercado Pago (Issue 18.5)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterator, Optional

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from core.config import settings
from core.database import Base, SessionLocal, engine, get_db
from core.dependencies import get_current_user
from core.tiempo import a_zona_negocio
from main import app
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.pago import Pago
from models.user import RoleEnum, User

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL_COBROS = "/api/v1/admin/cobros"


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se usan tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


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
                email=f"cobros_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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
    Sesión dentro de una transacción que se deshace al terminar el test.

    Arranca sin ingresos ni pagos, así los totales no dependen de lo que haya en la base,
    y al final la base queda exactamente como estaba.
    """
    conexion = engine.connect()
    transaccion = conexion.begin()
    sesion = Session(bind=conexion, join_transaction_mode="create_savepoint")

    sesion.query(Pago).delete(synchronize_session=False)
    sesion.query(IngresoFisico).delete(synchronize_session=False)
    sesion.flush()

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


def _efectivo(db: Session, monto: Optional[str], cuando: str) -> None:
    """Ingreso manual cobrado en efectivo. `cuando` es un ISO con zona."""
    db.add(IngresoFisico(
        jti=f"manual-{uuid.uuid4()}",
        dispositivo_id="dispositivo-test",
        fecha_hora_ingreso=datetime.fromisoformat(cuando),
        tipo_ingreso=TipoIngresoEnum.ESPONTANEO,
        sincronizado_offline=True,
        cantidad_personas=1,
        monto_cobrado=Decimal(monto) if monto is not None else None,
        nombre="Visitante Cobros",
        dni="30123456",
    ))
    db.flush()


def _pago(db: Session, monto: str, estado: str = "approved", aprobado: Optional[str] = None,
          creado: str = "2026-11-04T12:00:00-03:00") -> None:
    db.add(Pago(
        mp_payment_id=str(uuid.uuid4().int)[:12],
        estado=estado,
        monto=Decimal(monto),
        moneda="ARS",
        metodo_pago="visa",
        fecha_creacion=datetime.fromisoformat(creado),
        fecha_aprobacion=datetime.fromisoformat(aprobado) if aprobado else None,
        respuesta_mp={"status": estado},
    ))
    db.flush()


def _consultar(token: str, desde: str, hasta: str) -> dict:
    response = client.get(URL_COBROS, params={"desde": desde, "hasta": hasta}, headers=_headers(token))
    assert response.status_code == 200, response.text
    return response.json()


def _por_fecha(data: dict) -> Dict[str, dict]:
    return {dia["fecha"]: dia for dia in data["dias"]}


# --- Totales ---

def test_sin_cobros_devuelve_ceros_y_todos_los_dias_del_rango(db_aislada, tokens):
    data = _consultar(tokens["ADMIN"], "2026-11-01", "2026-11-03")

    assert data["total_efectivo"] == 0
    assert data["total_mercado_pago"] == 0
    assert data["total"] == 0
    assert [dia["fecha"] for dia in data["dias"]] == ["2026-11-01", "2026-11-02", "2026-11-03"]
    assert all(dia["total"] == 0 for dia in data["dias"])


def test_suma_el_efectivo_de_los_ingresos_manuales_por_dia(db_aislada, tokens):
    _efectivo(db_aislada, "4500.50", "2026-11-03T10:00:00-03:00")
    _efectivo(db_aislada, "1000", "2026-11-03T18:00:00-03:00")
    _efectivo(db_aislada, "2000", "2026-11-04T09:00:00-03:00")
    # Un ingreso con QR no trae monto: no es un cobro en la puerta
    _efectivo(db_aislada, None, "2026-11-03T11:00:00-03:00")

    data = _consultar(tokens["ADMIN"], "2026-11-03", "2026-11-04")
    dias = _por_fecha(data)

    assert dias["2026-11-03"]["efectivo"] == 5500.50
    assert dias["2026-11-04"]["efectivo"] == 2000
    assert data["total_efectivo"] == 7500.50
    assert data["total_mercado_pago"] == 0


def test_solo_cuenta_los_pagos_aprobados_de_mercado_pago(db_aislada, tokens):
    _pago(db_aislada, "15000", aprobado="2026-11-04T20:10:05-03:00")
    _pago(db_aislada, "9000", estado="rejected")
    _pago(db_aislada, "8000", estado="pending")
    _pago(db_aislada, "7000", estado="in_process")
    # Un pago reembolsado queda con otro estado y deja de contarse
    _pago(db_aislada, "6000", estado="refunded", aprobado="2026-11-04T10:00:00-03:00")

    data = _consultar(tokens["ADMIN"], "2026-11-04", "2026-11-04")

    assert data["total_mercado_pago"] == 15000
    assert data["dias"][0]["mercado_pago"] == 15000


def test_el_pago_cuenta_el_dia_de_la_aprobacion(db_aislada, tokens):
    _pago(db_aislada, "3000", creado="2026-11-03T23:50:00-03:00", aprobado="2026-11-04T00:05:00-03:00")
    # Sin fecha de aprobación se usa la de creación
    _pago(db_aislada, "1000", creado="2026-11-03T12:00:00-03:00")

    dias = _por_fecha(_consultar(tokens["ADMIN"], "2026-11-03", "2026-11-04"))

    assert dias["2026-11-03"]["mercado_pago"] == 1000
    assert dias["2026-11-04"]["mercado_pago"] == 3000


def test_los_dias_son_de_buenos_aires_y_no_de_utc(db_aislada, tokens):
    # 02:30 UTC del 4 son las 23:30 del 3 en Buenos Aires
    _efectivo(db_aislada, "500", "2026-11-04T02:30:00+00:00")
    _pago(db_aislada, "700", aprobado="2026-11-04T02:45:00+00:00")

    dias = _por_fecha(_consultar(tokens["ADMIN"], "2026-11-03", "2026-11-04"))

    assert dias["2026-11-03"]["efectivo"] == 500
    assert dias["2026-11-03"]["mercado_pago"] == 700
    assert dias["2026-11-04"]["total"] == 0


def test_totales_por_medio_de_pago_y_por_dia(db_aislada, tokens):
    _efectivo(db_aislada, "2000", "2026-11-03T10:00:00-03:00")
    _pago(db_aislada, "15000", aprobado="2026-11-03T15:00:00-03:00")
    _pago(db_aislada, "5000.25", aprobado="2026-11-04T15:00:00-03:00")

    data = _consultar(tokens["ADMIN"], "2026-11-03", "2026-11-04")
    dias = _por_fecha(data)

    assert dias["2026-11-03"] == {"fecha": "2026-11-03", "efectivo": 2000, "mercado_pago": 15000, "total": 17000}
    assert dias["2026-11-04"]["total"] == 5000.25
    assert data["total_efectivo"] == 2000
    assert data["total_mercado_pago"] == 20000.25
    assert data["total"] == 22000.25


def test_no_cuenta_cobros_fuera_del_rango(db_aislada, tokens):
    _efectivo(db_aislada, "100", "2026-11-02T23:59:00-03:00")
    _efectivo(db_aislada, "200", "2026-11-03T00:00:00-03:00")
    _efectivo(db_aislada, "300", "2026-11-04T00:00:00-03:00")

    data = _consultar(tokens["ADMIN"], "2026-11-03", "2026-11-03")

    assert data["total_efectivo"] == 200


def test_sin_fechas_muestra_la_ultima_semana_hasta_hoy(db_aislada, tokens):
    hoy = a_zona_negocio(datetime.now(timezone.utc)).date()

    response = client.get(URL_COBROS, headers=_headers(tokens["ADMIN"]))

    assert response.status_code == 200
    data = response.json()
    assert data["hasta"] == hoy.isoformat()
    assert data["desde"] == (hoy - timedelta(days=6)).isoformat()
    assert len(data["dias"]) == 7


# --- Validación del rango ---

def test_desde_posterior_a_hasta_devuelve_422(tokens):
    response = client.get(
        URL_COBROS, params={"desde": "2026-11-05", "hasta": "2026-11-04"}, headers=_headers(tokens["ADMIN"])
    )
    assert response.status_code == 422


def test_un_rango_de_mas_de_92_dias_devuelve_422(tokens):
    desde = date(2026, 1, 1)
    hasta = desde + timedelta(days=92)

    response = client.get(
        URL_COBROS, params={"desde": desde.isoformat(), "hasta": hasta.isoformat()}, headers=_headers(tokens["ADMIN"])
    )
    assert response.status_code == 422


def test_una_fecha_con_formato_invalido_devuelve_422(tokens):
    response = client.get(URL_COBROS, params={"desde": "04/11/2026"}, headers=_headers(tokens["ADMIN"]))
    assert response.status_code == 422


# --- Permisos ---

def test_sin_token_devuelve_401():
    assert client.get(URL_COBROS).status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otros_roles_reciben_403(rol, tokens):
    assert client.get(URL_COBROS, headers=_headers(tokens[rol])).status_code == 403
