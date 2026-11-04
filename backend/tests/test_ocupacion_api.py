import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Dict, Iterator, Optional

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from core.config import settings
from core.database import Base, SessionLocal, engine, get_db
from core.dependencies import get_current_user
from main import app
from models.conflictos import ConflictosSincronizacion
from models.egreso_fisico import EgresoFisico
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User
from services.ocupacion_service import obtener_ocupacion

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL_OCUPACION = "/api/v1/ocupacion"
URL_SYNC = "/api/v1/ingresos/bulk-sync"


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
    """Un usuario por rol. Se borran al terminar el módulo."""
    db = SessionLocal()
    creados: Dict[str, uuid.UUID] = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"ocupacion_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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


@pytest.fixture
def tokens(ids: Dict[str, uuid.UUID]) -> Dict[str, str]:
    return {rol: _token(user_id) for rol, user_id in ids.items()}


@pytest.fixture
def db_aislada() -> Iterator[Session]:
    """
    Sesión dentro de una transacción que se deshace al terminar el test.

    Arranca sin ingresos ni egresos, así la ocupación no depende de lo que haya en la base.
    Los commit() de los endpoints solo cierran un savepoint: nada de lo que pase acá se guarda
    y al final la base queda exactamente como estaba.
    """
    conexion = engine.connect()
    transaccion = conexion.begin()
    sesion = Session(bind=conexion, join_transaction_mode="create_savepoint")

    sesion.query(EgresoFisico).delete(synchronize_session=False)
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


def _ingreso(db: Session, cantidad: Optional[int], reserva_id: Optional[uuid.UUID] = None) -> None:
    db.add(IngresoFisico(
        jti=f"manual-{uuid.uuid4()}",
        reserva_id=reserva_id,
        dispositivo_id="dispositivo-test",
        fecha_hora_ingreso=datetime.now(timezone.utc),
        tipo_ingreso=TipoIngresoEnum.ESPONTANEO,
        sincronizado_offline=True,
        cantidad_personas=cantidad,
        monto_cobrado=Decimal("0"),
        nombre="Visitante Ocupacion",
        dni="30123456",
    ))
    db.flush()


def _egreso(db: Session, cantidad: int, admin_id: uuid.UUID) -> None:
    db.add(EgresoFisico(
        cantidad_personas=cantidad,
        fecha_hora_egreso=datetime.now(timezone.utc),
        registrado_por_id=admin_id,
    ))
    db.flush()


def _reserva(db: Session, camping_id: str) -> uuid.UUID:
    usuario = User(
        email=f"ocupacion_reserva_{uuid.uuid4()}@grupo8.com",
        password_hash="secreto",
        nombre="Titular Ocupacion",
        dni=str(uuid.uuid4().int)[:8],
    )
    db.add(usuario)
    db.flush()
    reserva = Reserva(
        user_id=usuario.id,
        camping_id=camping_id,
        fecha_ingreso=date(2099, 12, 20),
        fecha_egreso=date(2099, 12, 22),
        cantidad_personas=2,
        monto_total=10000.0,
        titular=usuario.nombre,
        email=usuario.email,
        estado_reserva=EstadoReservaEnum.CONFIRMADA,
        estado_pago=EstadoPagoEnum.PAGADO,
    )
    db.add(reserva)
    db.flush()
    return reserva.id


def _consultar(token: str) -> Dict[str, int]:
    response = client.get(URL_OCUPACION, headers=_headers(token))
    assert response.status_code == 200, response.text
    return response.json()


# --- Cálculo ---

def test_sin_movimientos_la_ocupacion_es_cero(db_aislada, tokens):
    data = _consultar(tokens["ADMIN"])

    assert data == {
        "ocupacion_actual": 0,
        "capacidad_maxima": settings.CAMPING_TOTAL_CAPACITY,
        "buffer_offline": settings.CAMPING_OFFLINE_BUFFER,
    }


def test_solo_ingresos_suma_las_personas_de_cada_uno(db_aislada, tokens):
    _ingreso(db_aislada, 3)
    _ingreso(db_aislada, 2)

    assert _consultar(tokens["ADMIN"])["ocupacion_actual"] == 5


def test_un_ingreso_viejo_sin_cantidad_cuenta_como_una_persona(db_aislada, tokens):
    _ingreso(db_aislada, 3)
    _ingreso(db_aislada, None)

    assert _consultar(tokens["ADMIN"])["ocupacion_actual"] == 4


def test_ingresos_y_egresos_resta_los_que_salieron(db_aislada, tokens, ids):
    _ingreso(db_aislada, 4)
    _ingreso(db_aislada, 3)
    _egreso(db_aislada, 2, ids["ADMIN"])

    assert _consultar(tokens["ADMIN"])["ocupacion_actual"] == 5


def test_la_ocupacion_nunca_es_negativa(db_aislada, tokens, ids):
    # Puede pasar si se registró un egreso antes de que los guardias sincronicen sus ingresos
    _ingreso(db_aislada, 1)
    _egreso(db_aislada, 3, ids["ADMIN"])

    assert _consultar(tokens["ADMIN"])["ocupacion_actual"] == 0


def test_un_qr_clonado_no_suma_a_la_ocupacion(db_aislada, tokens, camping_de_prueba):
    reserva_id = str(_reserva(db_aislada, camping_de_prueba))
    jti = str(uuid.uuid4())
    original = {
        "tipo_ingreso": "QR",
        "jti": jti,
        "reserva_id": reserva_id,
        "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
        "dispositivo_id": "dispositivo-A",
        "cantidad_personas": 2,
    }
    clon = {**original, "dispositivo_id": "dispositivo-B"}

    for item in (original, clon):
        response = client.post(URL_SYNC, json={"ingresos": [item]}, headers=_headers(tokens["SEGURIDAD"]))
        assert response.status_code == 200, response.text

    # El clon quedó registrado como conflicto, pero no como ingreso
    assert db_aislada.query(ConflictosSincronizacion).filter(
        ConflictosSincronizacion.jti_involucrado == jti
    ).count() == 1
    assert _consultar(tokens["ADMIN"])["ocupacion_actual"] == 2


def test_la_capacidad_y_el_buffer_salen_de_settings(db_aislada, tokens, monkeypatch):
    monkeypatch.setattr(settings, "CAMPING_TOTAL_CAPACITY", 120)
    monkeypatch.setattr(settings, "CAMPING_OFFLINE_BUFFER", 12)

    data = _consultar(tokens["ADMIN"])

    assert data["capacidad_maxima"] == 120
    assert data["buffer_offline"] == 12


def test_el_servicio_devuelve_lo_mismo_que_el_endpoint(db_aislada, tokens, ids):
    _ingreso(db_aislada, 6)
    _egreso(db_aislada, 1, ids["ADMIN"])

    ocupacion = obtener_ocupacion(db_aislada)

    assert ocupacion.ocupacion_actual == 5
    assert _consultar(tokens["ADMIN"])["ocupacion_actual"] == ocupacion.ocupacion_actual


# --- Permisos ---

def test_sin_token_devuelve_401():
    assert client.get(URL_OCUPACION).status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otros_roles_reciben_403(rol, tokens):
    assert client.get(URL_OCUPACION, headers=_headers(tokens[rol])).status_code == 403