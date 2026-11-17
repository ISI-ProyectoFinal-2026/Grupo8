"""Historial de ingresos del panel: GET /api/v1/admin/ingresos (Issue 26.6)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterator, List, Optional

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from core.config import settings
from core.database import Base, engine, get_db
from core.dependencies import get_current_user
from core.tiempo import hoy_negocio
from main import app
from models.conflictos import ConflictosSincronizacion
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import CondicionPersonaEnum, EstadoReservaEnum, Reserva, ReservaPersona
from models.user import RoleEnum, User

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL = "/api/v1/admin/ingresos"


@pytest.fixture(autouse=True)
def sin_override_de_autenticacion() -> Iterator[None]:
    """Otros módulos reemplazan get_current_user; acá se usan tokens reales."""
    previo = app.dependency_overrides.pop(get_current_user, None)
    yield
    if previo is not None:
        app.dependency_overrides[get_current_user] = previo


@pytest.fixture
def db_aislada() -> Iterator[Session]:
    """
    Sesión dentro de una transacción que se deshace al terminar el test. Arranca sin ingresos,
    así el total no depende de lo que haya en la base, y al final la base queda como estaba.
    """
    conexion = engine.connect()
    transaccion = conexion.begin()
    sesion = Session(bind=conexion, join_transaction_mode="create_savepoint")
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


def _usuario(db: Session, rol: RoleEnum, **extra) -> User:
    usuario = User(
        email=f"ingresos_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
        password_hash="secreto",
        nombre=f"Usuario {rol.name}",
        dni=extra.pop("dni", str(uuid.uuid4().int)[:8]),
        rol=rol,
        **extra,
    )
    db.add(usuario)
    db.flush()
    return usuario


def _headers(usuario: User) -> Dict[str, str]:
    token = jwt.encode({"sub": str(usuario.id)}, settings.AUTH_SECRET_KEY, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(db_aislada: Session) -> Dict[str, str]:
    return _headers(_usuario(db_aislada, RoleEnum.ADMIN))


def _reserva(db: Session, camping_id: str, user_id: Optional[uuid.UUID] = None,
             condicion_titular: CondicionPersonaEnum = CondicionPersonaEnum.visitante) -> Reserva:
    reserva = Reserva(
        camping_id=camping_id,
        user_id=user_id,
        fecha_ingreso=hoy_negocio(),
        fecha_egreso=hoy_negocio(),
        cantidad_personas=2,
        monto_total=10000.0,
        titular="Titular Historial",
        email="historial@grupo8.com",
        estado_reserva=EstadoReservaEnum.CONFIRMADA,
    )
    db.add(reserva)
    db.flush()
    db.add(ReservaPersona(
        reserva_id=reserva.id, orden=0, nombre="Titular Historial", edad=40,
        condicion=condicion_titular, precio_base=5000, descuento_pct=0, precio_final=5000,
    ))
    db.flush()
    return reserva


def _ingreso(db: Session, cuando: datetime, reserva: Optional[Reserva] = None,
             personas: Optional[int] = 1, dni: Optional[str] = None) -> IngresoFisico:
    """Con reserva es un escaneo de QR; sin reserva, un ingreso manual."""
    ingreso = IngresoFisico(
        jti=f"jti-{uuid.uuid4()}",
        dispositivo_id="dispositivo-test",
        reserva_id=reserva.id if reserva else None,
        fecha_hora_ingreso=cuando,
        tipo_ingreso=TipoIngresoEnum.WEB if reserva else TipoIngresoEnum.ESPONTANEO,
        sincronizado_offline=True,
        cantidad_personas=personas,
        dni=dni,
    )
    db.add(ingreso)
    db.flush()
    return ingreso


def _ids(respuesta) -> List[str]:
    return [item["id"] for item in respuesta.json()["items"]]


# ---------- Permisos ----------

@pytest.mark.parametrize("rol", [RoleEnum.SEGURIDAD, RoleEnum.CLIENTE])
def test_otros_roles_reciben_403(db_aislada, rol):
    respuesta = client.get(URL, headers=_headers(_usuario(db_aislada, rol)))
    assert respuesta.status_code == 403


def test_sin_token_recibe_401(db_aislada):
    assert client.get(URL).status_code == 401


# ---------- Días de Buenos Aires ----------

def test_sin_fechas_muestra_solo_hoy(db_aislada, admin):
    hoy = _ingreso(db_aislada, datetime.now(timezone.utc))
    _ingreso(db_aislada, datetime.now(timezone.utc) - timedelta(days=2))

    respuesta = client.get(URL, headers=admin)

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["desde"] == cuerpo["hasta"] == hoy_negocio().isoformat()
    assert cuerpo["total"] == 1
    assert _ids(respuesta) == [str(hoy.id)]


def test_el_dia_se_corta_en_la_medianoche_argentina_y_no_en_la_de_utc(db_aislada, admin):
    # 17/11 en Buenos Aires va de 2026-11-17T03:00Z a 2026-11-18T03:00Z
    ayer_23_30 = _ingreso(db_aislada, datetime.fromisoformat("2026-11-16T23:30:00-03:00"))
    hoy_00_30 = _ingreso(db_aislada, datetime.fromisoformat("2026-11-17T00:30:00-03:00"))
    hoy_23_59 = _ingreso(db_aislada, datetime.fromisoformat("2026-11-17T23:59:59.900-03:00"))
    manana_00_00 = _ingreso(db_aislada, datetime.fromisoformat("2026-11-18T00:00:00-03:00"))

    solo_el_17 = client.get(URL, params={"desde": "2026-11-17"}, headers=admin)
    assert solo_el_17.json()["total"] == 2
    assert _ids(solo_el_17) == [str(hoy_23_59.id), str(hoy_00_30.id)]

    rango = client.get(URL, params={"desde": "2026-11-16", "hasta": "2026-11-17"}, headers=admin)
    assert set(_ids(rango)) == {str(ayer_23_30.id), str(hoy_00_30.id), str(hoy_23_59.id)}

    solo_el_18 = client.get(URL, params={"hasta": "2026-11-18"}, headers=admin)
    assert _ids(solo_el_18) == [str(manana_00_00.id)]


def test_la_hora_vuelve_en_utc(db_aislada, admin):
    _ingreso(db_aislada, datetime.fromisoformat("2026-11-17T00:30:00-03:00"))

    item = client.get(URL, params={"desde": "2026-11-17"}, headers=admin).json()["items"][0]

    assert datetime.fromisoformat(item["fecha_hora_ingreso"]) == datetime(2026, 11, 17, 3, 30, tzinfo=timezone.utc)


def test_desde_posterior_a_hasta_da_422(db_aislada, admin):
    respuesta = client.get(URL, params={"desde": "2026-11-18", "hasta": "2026-11-17"}, headers=admin)
    assert respuesta.status_code == 422


def test_un_rango_de_mas_de_92_dias_da_422(db_aislada, admin):
    respuesta = client.get(URL, params={"desde": "2026-01-01", "hasta": "2026-12-31"}, headers=admin)
    assert respuesta.status_code == 422


# ---------- Paginación ----------

def test_pagina_del_mas_nuevo_al_mas_viejo_con_el_total(db_aislada, admin):
    base = datetime.fromisoformat("2026-11-17T10:00:00-03:00")
    ingresos = [_ingreso(db_aislada, base + timedelta(minutes=i)) for i in range(5)]
    mas_nuevos_primero = [str(i.id) for i in reversed(ingresos)]

    primera = client.get(URL, params={"desde": "2026-11-17", "limit": 2}, headers=admin)
    segunda = client.get(URL, params={"desde": "2026-11-17", "limit": 2, "skip": 2}, headers=admin)
    ultima = client.get(URL, params={"desde": "2026-11-17", "limit": 2, "skip": 4}, headers=admin)

    assert primera.json()["total"] == segunda.json()["total"] == 5
    assert _ids(primera) + _ids(segunda) + _ids(ultima) == mas_nuevos_primero


def test_limit_fuera_de_rango_da_422(db_aislada, admin):
    assert client.get(URL, params={"limit": 101}, headers=admin).status_code == 422
    assert client.get(URL, params={"limit": 0}, headers=admin).status_code == 422


# ---------- Contenido de cada fila ----------

def test_cada_fila_trae_reserva_personas_tipo_de_cliente_y_tipo_de_ingreso(
    db_aislada, admin, camping_de_prueba
):
    socio = _usuario(db_aislada, RoleEnum.CLIENTE, is_socio=True, dni="27111222")
    cuando = datetime.fromisoformat("2026-11-17T12:00:00-03:00")

    # Reserva hecha por un socio con sesión, otra de un visitante, y dos manuales
    qr_socio = _ingreso(db_aislada, cuando, _reserva(db_aislada, camping_de_prueba, user_id=socio.id), personas=3)
    qr_visitante = _ingreso(db_aislada, cuando + timedelta(minutes=1), _reserva(db_aislada, camping_de_prueba), personas=2)
    manual_socio = _ingreso(db_aislada, cuando + timedelta(minutes=2), dni="27111222")
    manual_visitante = _ingreso(db_aislada, cuando + timedelta(minutes=3), dni="40999888", personas=None)

    items = {i["id"]: i for i in client.get(URL, params={"desde": "2026-11-17"}, headers=admin).json()["items"]}

    assert {k: items[str(qr_socio.id)][k] for k in ("reserva_id", "personas", "tipo_cliente", "tipo_ingreso")} == {
        "reserva_id": str(qr_socio.reserva_id), "personas": 3, "tipo_cliente": "socio", "tipo_ingreso": "web",
    }
    assert items[str(qr_visitante.id)]["tipo_cliente"] == "visitante"
    assert {k: items[str(manual_socio.id)][k] for k in ("reserva_id", "tipo_cliente", "tipo_ingreso")} == {
        "reserva_id": None, "tipo_cliente": "socio", "tipo_ingreso": "manual",
    }
    # Sin cantidad guardada (ingresos anteriores a la 16.1) se cuenta 1 persona
    assert items[str(manual_visitante.id)]["personas"] == 1
    assert items[str(manual_visitante.id)]["tipo_cliente"] == "visitante"


def test_un_titular_cargado_como_socio_cuenta_como_socio(db_aislada, admin, camping_de_prueba):
    reserva = _reserva(db_aislada, camping_de_prueba, condicion_titular=CondicionPersonaEnum.socio)
    _ingreso(db_aislada, datetime.fromisoformat("2026-11-17T12:00:00-03:00"), reserva)

    item = client.get(URL, params={"desde": "2026-11-17"}, headers=admin).json()["items"][0]

    assert item["tipo_cliente"] == "socio"


def test_un_dni_de_socio_dado_de_baja_cuenta_como_visitante(db_aislada, admin):
    _usuario(db_aislada, RoleEnum.CLIENTE, is_socio=True, activo=False, dni="27333444")
    _ingreso(db_aislada, datetime.fromisoformat("2026-11-17T12:00:00-03:00"), dni="27333444")

    item = client.get(URL, params={"desde": "2026-11-17"}, headers=admin).json()["items"][0]

    assert item["tipo_cliente"] == "visitante"


def test_un_qr_rechazado_por_clonacion_no_aparece(db_aislada, admin, camping_de_prueba):
    reserva = _reserva(db_aislada, camping_de_prueba)
    cuando = datetime.fromisoformat("2026-11-17T12:00:00-03:00")
    aceptado = _ingreso(db_aislada, cuando, reserva)
    # El segundo escaneo del mismo QR desde otro dispositivo queda solo como conflicto
    db_aislada.add(ConflictosSincronizacion(
        reserva_id=reserva.id,
        jti_involucrado=aceptado.jti,
        dispositivo_id="otro-dispositivo",
        motivo="QR clonado: mismo jti desde otro dispositivo",
        fecha_registro=cuando + timedelta(minutes=5),
    ))
    reserva.marcar_alerta_clonacion()
    db_aislada.flush()

    respuesta = client.get(URL, params={"desde": "2026-11-17"}, headers=admin)

    # El ingreso original sí entró al camping, así que se sigue viendo; el clon no
    assert respuesta.json()["total"] == 1
    assert _ids(respuesta) == [str(aceptado.id)]
