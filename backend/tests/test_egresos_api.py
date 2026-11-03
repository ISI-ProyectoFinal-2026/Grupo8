import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Callable, Dict, Iterator, List

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from core.tiempo import ZONA_NEGOCIO
from main import app
from models.egreso_fisico import EgresoFisico
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.user import RoleEnum, User
from services.ocupacion_service import personas_dentro

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL_EGRESOS = "/api/v1/egresos"


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
def ids() -> Iterator[Dict[str, uuid.UUID]]:
    """Un usuario por rol. Al terminar se borran sus egresos y después los usuarios."""
    db = SessionLocal()
    creados: Dict[str, uuid.UUID] = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"egreso_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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
        db.query(EgresoFisico).filter(
            EgresoFisico.registrado_por_id.in_(list(creados.values()))
        ).delete(synchronize_session=False)
        db.query(User).filter(User.id.in_(list(creados.values()))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def tokens(ids: Dict[str, uuid.UUID]) -> Dict[str, str]:
    return {rol: _token(user_id) for rol, user_id in ids.items()}


@pytest.fixture(autouse=True)
def limpiar_egresos(ids: Dict[str, uuid.UUID]) -> Iterator[None]:
    """Cada test borra sus egresos al terminar, igual que sus ingresos: así la
    ocupación vuelve a quedar como estaba y no afecta al test siguiente."""
    yield
    db = SessionLocal()
    try:
        db.query(EgresoFisico).filter(
            EgresoFisico.registrado_por_id.in_(list(ids.values()))
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def crear_ingreso() -> Iterator[Callable[[int], str]]:
    """Factory: guarda un ingreso manual con la cantidad pedida y lo borra al terminar el test."""
    jtis: List[str] = []

    def _crear(cantidad: int) -> str:
        jti = f"manual-{uuid.uuid4()}"
        db = SessionLocal()
        try:
            db.add(IngresoFisico(
                jti=jti,
                dispositivo_id="dispositivo-test",
                fecha_hora_ingreso=datetime.now(timezone.utc),
                tipo_ingreso=TipoIngresoEnum.ESPONTANEO,
                sincronizado_offline=True,
                cantidad_personas=cantidad,
                monto_cobrado=Decimal("0"),
                nombre="Visitante Egreso",
                dni="30123456",
            ))
            db.commit()
        finally:
            db.close()
        jtis.append(jti)
        return jti

    yield _crear

    db = SessionLocal()
    try:
        db.query(IngresoFisico).filter(IngresoFisico.jti.in_(jtis)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _dentro() -> int:
    db = SessionLocal()
    try:
        return personas_dentro(db)
    finally:
        db.close()


def _egresos_de(user_id: uuid.UUID) -> int:
    db = SessionLocal()
    try:
        return db.query(EgresoFisico).filter(EgresoFisico.registrado_por_id == user_id).count()
    finally:
        db.close()


def _hora_guardada(egreso_id: str) -> datetime:
    db = SessionLocal()
    try:
        return db.query(EgresoFisico).filter(EgresoFisico.id == uuid.UUID(egreso_id)).one().fecha_hora_egreso
    finally:
        db.close()


def _registrar(token: str, **datos):
    return client.post(URL_EGRESOS, json=datos, headers=_headers(token))


# --- Alta ---

def test_admin_registra_un_egreso_y_baja_la_ocupacion(tokens, ids, crear_ingreso):
    crear_ingreso(3)
    antes = _dentro()

    response = _registrar(tokens["ADMIN"], cantidad_personas=2)

    assert response.status_code == 201
    data = response.json()
    assert data["cantidad_personas"] == 2
    assert data["registrado_por_id"] == str(ids["ADMIN"])
    assert data["personas_dentro"] == antes - 2
    assert _dentro() == antes - 2


def test_pueden_egresar_todas_las_personas_que_hay_dentro(tokens, crear_ingreso):
    crear_ingreso(2)
    dentro = _dentro()

    response = _registrar(tokens["ADMIN"], cantidad_personas=dentro)

    assert response.status_code == 201
    assert response.json()["personas_dentro"] == 0


def test_la_columna_de_la_hora_de_egreso_guarda_zona_horaria():
    # Si falla, falta correr alembic upgrade head
    columnas = inspect(engine).get_columns("egresos_fisicos")
    columna = next(c for c in columnas if c["name"] == "fecha_hora_egreso")

    assert columna["type"].timezone is True


# --- Hora (como en 16.4) ---

@pytest.mark.parametrize(
    "fecha_enviada",
    [
        "2026-10-25T14:30:00.000Z",
        "2026-10-25T14:30:00+00:00",
        "2026-10-25T11:30:00-03:00",  # la misma hora, escrita en Buenos Aires
    ],
)
def test_la_hora_se_guarda_en_utc_sin_importar_como_llegue(fecha_enviada, tokens, crear_ingreso):
    crear_ingreso(1)

    response = _registrar(tokens["ADMIN"], cantidad_personas=1, fecha_hora_egreso=fecha_enviada)

    assert response.status_code == 201
    guardada = _hora_guardada(response.json()["id"])
    assert guardada == datetime(2026, 10, 25, 14, 30, tzinfo=timezone.utc)
    assert guardada.astimezone(ZONA_NEGOCIO).hour == 11


def test_sin_hora_se_usa_la_hora_actual(tokens, crear_ingreso):
    crear_ingreso(1)
    antes = datetime.now(timezone.utc)

    response = _registrar(tokens["ADMIN"], cantidad_personas=1)

    assert response.status_code == 201
    guardada = _hora_guardada(response.json()["id"])
    assert antes - timedelta(seconds=5) <= guardada <= datetime.now(timezone.utc) + timedelta(seconds=5)


def test_una_hora_sin_zona_horaria_se_rechaza_y_no_se_guarda(tokens, ids, crear_ingreso):
    crear_ingreso(1)
    previos = _egresos_de(ids["ADMIN"])

    response = _registrar(tokens["ADMIN"], cantidad_personas=1, fecha_hora_egreso="2026-10-25T14:30:00")

    assert response.status_code == 422
    assert "zona horaria" in response.text
    assert _egresos_de(ids["ADMIN"]) == previos


def test_una_hora_en_el_futuro_se_rechaza(tokens, ids, crear_ingreso):
    crear_ingreso(1)
    previos = _egresos_de(ids["ADMIN"])
    manana = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    response = _registrar(tokens["ADMIN"], cantidad_personas=1, fecha_hora_egreso=manana)

    assert response.status_code == 422
    assert _egresos_de(ids["ADMIN"]) == previos


# --- Validación de la cantidad ---

@pytest.mark.parametrize("cantidad", [0, -1])
def test_la_cantidad_tiene_que_ser_al_menos_1(cantidad, tokens, ids):
    previos = _egresos_de(ids["ADMIN"])

    response = _registrar(tokens["ADMIN"], cantidad_personas=cantidad)

    assert response.status_code == 422
    assert _egresos_de(ids["ADMIN"]) == previos


def test_la_cantidad_es_obligatoria(tokens):
    assert _registrar(tokens["ADMIN"]).status_code == 422


def test_no_pueden_egresar_mas_personas_de_las_que_hay_dentro(tokens, ids, crear_ingreso):
    crear_ingreso(2)
    dentro = _dentro()
    previos = _egresos_de(ids["ADMIN"])

    response = _registrar(tokens["ADMIN"], cantidad_personas=dentro + 1)

    assert response.status_code == 409
    assert str(dentro) in response.json()["detail"]
    assert _egresos_de(ids["ADMIN"]) == previos
    assert _dentro() == dentro


def test_los_egresos_anteriores_se_descuentan_al_validar(tokens, crear_ingreso):
    crear_ingreso(2)
    dentro = _dentro()

    assert _registrar(tokens["ADMIN"], cantidad_personas=dentro).status_code == 201
    # Ya no queda nadie dentro: otro egreso tiene que rechazarse
    assert _registrar(tokens["ADMIN"], cantidad_personas=1).status_code == 409


# --- Permisos ---

def test_sin_token_devuelve_401():
    assert client.post(URL_EGRESOS, json={"cantidad_personas": 1}).status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otros_roles_reciben_403_y_no_se_guarda_nada(rol, tokens, ids, crear_ingreso):
    crear_ingreso(1)

    response = _registrar(tokens[rol], cantidad_personas=1)

    assert response.status_code == 403
    assert _egresos_de(ids[rol]) == 0