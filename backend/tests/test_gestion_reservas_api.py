import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, Iterator, List, Optional

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from core.config import settings
from core.database import Base, SessionLocal, engine, get_db
from core.dependencies import get_current_user
from main import app
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.pago import Pago
from models.reserva import (
    CondicionPersonaEnum,
    EstadoPagoEnum,
    EstadoReservaEnum,
    Reserva,
    ReservaPersona,
)
from models.tipo_reserva import FormaCobroEnum, TipoReserva
from models.user import RoleEnum, User

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# Fechas lejanas: ninguna otra reserva de la base cae en este rango, así los listados
# dependen solo de lo que crea cada test
DESDE = date(2096, 5, 1)
HASTA = date(2096, 5, 31)
RANGO = {"fecha_desde": str(DESDE), "fecha_hasta": str(HASTA)}


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
                email=f"gestion_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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
    Sesión dentro de una transacción que se deshace al terminar el test: lo que se crea
    acá no queda guardado.
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


def _socio(db: Session) -> User:
    usuario = User(
        email=f"socio_{uuid.uuid4()}@grupo8.com",
        password_hash="secreto",
        nombre="Socio de Prueba",
        dni=str(uuid.uuid4().int)[:8],
        rol=RoleEnum.CLIENTE,
        is_socio=True,
    )
    db.add(usuario)
    db.flush()
    return usuario


def _reserva(
    db: Session,
    camping_id: str,
    titular: str = "Titular de Prueba",
    email: str = "gestion@grupo8.com",
    ingreso: date = date(2096, 5, 10),
    estado_reserva: EstadoReservaEnum = EstadoReservaEnum.CONFIRMADA,
    estado_pago: EstadoPagoEnum = EstadoPagoEnum.PAGADO,
    user_id: Optional[uuid.UUID] = None,
    condiciones: Optional[List[CondicionPersonaEnum]] = None,
    tipo_reserva_id: Optional[uuid.UUID] = None,
    hecha_hace_minutos: int = 0,
) -> Reserva:
    """Crea una reserva. `condiciones` es la condición de cada persona; la primera es el titular."""
    condiciones = condiciones if condiciones is not None else [CondicionPersonaEnum.visitante]
    reserva = Reserva(
        camping_id=camping_id,
        user_id=user_id,
        tipo_reserva_id=tipo_reserva_id,
        fecha_reserva=datetime.utcnow() - timedelta(minutes=hecha_hace_minutos),
        fecha_ingreso=ingreso,
        fecha_egreso=ingreso + timedelta(days=1),
        cantidad_personas=max(len(condiciones), 1),
        monto_total=15000.0,
        titular=titular,
        email=email,
        estado_reserva=estado_reserva,
        estado_pago=estado_pago,
    )
    db.add(reserva)
    db.flush()
    for orden, condicion in enumerate(condiciones):
        db.add(ReservaPersona(
            reserva_id=reserva.id,
            orden=orden,
            nombre=titular if orden == 0 else f"Acompañante {orden}",
            edad=30,
            condicion=condicion,
            dni=str(uuid.uuid4().int)[:8] if condicion == CondicionPersonaEnum.socio else None,
            precio_base=Decimal("7500"),
            descuento_pct=Decimal("0"),
            precio_final=Decimal("7500"),
        ))
    db.flush()
    db.refresh(reserva)
    return reserva


def _listar(token: str, **filtros: object) -> Dict:
    """Lista dentro del rango de fechas de prueba, con los filtros que se pasen."""
    params = {**RANGO, "limit": 100, **filtros}
    response = client.get("/reservas/", params=params, headers=_headers(token))
    assert response.status_code == 200, response.text
    return response.json()


def _ids(datos: Dict) -> List[str]:
    return [item["id"] for item in datos["items"]]


# --- Listado: paginación y orden ---

def test_devuelve_el_total_y_la_pagina_pedida(db_aislada, tokens, camping_de_prueba):
    for _ in range(3):
        _reserva(db_aislada, camping_de_prueba)

    primera = _listar(tokens["ADMIN"], limit=2)
    segunda = _listar(tokens["ADMIN"], limit=2, skip=2)

    assert primera["total"] == 3 and len(primera["items"]) == 2
    assert segunda["total"] == 3 and len(segunda["items"]) == 1
    assert set(_ids(primera)).isdisjoint(_ids(segunda))


def test_las_reservas_mas_nuevas_van_primero(db_aislada, tokens, camping_de_prueba):
    vieja = _reserva(db_aislada, camping_de_prueba, hecha_hace_minutos=60)
    nueva = _reserva(db_aislada, camping_de_prueba)

    assert _ids(_listar(tokens["ADMIN"])) == [str(nueva.id), str(vieja.id)]


def test_cada_fila_trae_los_datos_de_la_tabla(db_aislada, tokens, camping_de_prueba):
    reserva = _reserva(db_aislada, camping_de_prueba, titular="Ana Pérez",
                       condiciones=[CondicionPersonaEnum.visitante] * 2)

    fila = _listar(tokens["ADMIN"])["items"][0]

    assert fila["id"] == str(reserva.id)
    assert fila["titular"] == "Ana Pérez"
    assert fila["tipo_cliente"] == "visitante"
    assert fila["fecha_ingreso"] == "2096-05-10"
    assert fila["fecha_egreso"] == "2096-05-11"
    assert fila["cantidad_personas"] == 2
    assert fila["monto_total"] == 15000.0
    assert fila["estado_reserva"] == EstadoReservaEnum.CONFIRMADA.value
    assert fila["estado_pago"] == EstadoPagoEnum.PAGADO.value


# --- Listado: filtros ---

def test_filtra_por_estado_de_la_reserva(db_aislada, tokens, camping_de_prueba):
    confirmada = _reserva(db_aislada, camping_de_prueba)
    _reserva(db_aislada, camping_de_prueba, estado_reserva=EstadoReservaEnum.CANCELADA)

    datos = _listar(tokens["ADMIN"], estado_reserva="Confirmada")

    assert _ids(datos) == [str(confirmada.id)]
    assert datos["total"] == 1


def test_sigue_filtrando_por_estado_de_pago(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba)
    pendiente = _reserva(db_aislada, camping_de_prueba, estado_reserva=EstadoReservaEnum.PENDIENTE,
                         estado_pago=EstadoPagoEnum.PENDIENTE)

    assert _ids(_listar(tokens["ADMIN"], estado="Pendiente")) == [str(pendiente.id)]


def test_filtra_por_rango_de_fechas_de_ingreso_con_ambos_extremos(db_aislada, tokens, camping_de_prueba):
    antes = _reserva(db_aislada, camping_de_prueba, ingreso=date(2096, 5, 4))
    desde = _reserva(db_aislada, camping_de_prueba, ingreso=date(2096, 5, 5))
    hasta = _reserva(db_aislada, camping_de_prueba, ingreso=date(2096, 5, 7))
    despues = _reserva(db_aislada, camping_de_prueba, ingreso=date(2096, 5, 8))

    ids = _ids(_listar(tokens["ADMIN"], fecha_desde="2096-05-05", fecha_hasta="2096-05-07"))
    assert set(ids) == {str(desde.id), str(hasta.id)}
    assert str(antes.id) not in ids and str(despues.id) not in ids


def test_filtra_por_tipo_de_cliente(db_aislada, tokens, camping_de_prueba):
    con_sesion = _reserva(db_aislada, camping_de_prueba, user_id=_socio(db_aislada).id,
                          condiciones=[CondicionPersonaEnum.socio])
    # Un socio puede reservar sin iniciar sesión cargándose como socio
    sin_sesion = _reserva(db_aislada, camping_de_prueba, condiciones=[CondicionPersonaEnum.socio])
    # Un visitante que lleva a un socio como acompañante sigue siendo una reserva de visitante
    visitante = _reserva(db_aislada, camping_de_prueba,
                         condiciones=[CondicionPersonaEnum.visitante, CondicionPersonaEnum.socio])

    socios = _listar(tokens["ADMIN"], tipo_cliente="socio")
    visitantes = _listar(tokens["ADMIN"], tipo_cliente="visitante")

    assert set(_ids(socios)) == {str(con_sesion.id), str(sin_sesion.id)}
    assert _ids(visitantes) == [str(visitante.id)]
    assert {item["tipo_cliente"] for item in socios["items"]} == {"socio"}
    assert visitantes["items"][0]["tipo_cliente"] == "visitante"


def test_un_tipo_de_cliente_desconocido_responde_422(db_aislada, tokens):
    response = client.get("/reservas/?tipo_cliente=empresa", headers=_headers(tokens["ADMIN"]))

    assert response.status_code == 422


@pytest.mark.parametrize("busqueda", ["Pérez", "perez", "PEREZ", "PÉREZ", "ÁNA", "ana pe", "perez ana"])
def test_busca_por_titular_sin_importar_mayusculas_ni_acentos(
    db_aislada, tokens, camping_de_prueba, busqueda
):
    buscada = _reserva(db_aislada, camping_de_prueba, titular="Ana Pérez")
    _reserva(db_aislada, camping_de_prueba, titular="Luis Gómez")

    assert _ids(_listar(tokens["ADMIN"], busqueda=busqueda)) == [str(buscada.id)]


def test_la_busqueda_ignora_acentos_guardados_en_mayuscula_y_la_enie(db_aislada, tokens, camping_de_prueba):
    buscada = _reserva(db_aislada, camping_de_prueba, titular="ÁNGELA PEÑA")
    _reserva(db_aislada, camping_de_prueba, titular="Luis Gómez")

    assert _ids(_listar(tokens["ADMIN"], busqueda="angela pena")) == [str(buscada.id)]


def test_todas_las_palabras_tienen_que_estar_en_el_titular(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, titular="Ana Pérez")

    assert _listar(tokens["ADMIN"], busqueda="ana gomez")["total"] == 0


def test_busca_por_email(db_aislada, tokens, camping_de_prueba):
    buscada = _reserva(db_aislada, camping_de_prueba, email="ana.perez@correo.com")
    _reserva(db_aislada, camping_de_prueba, email="otro@correo.com")

    assert _ids(_listar(tokens["ADMIN"], busqueda="ANA.PEREZ@")) == [str(buscada.id)]


@pytest.mark.parametrize("prefijo", ["", "#"])
def test_busca_por_numero_de_reserva(db_aislada, tokens, camping_de_prueba, prefijo):
    buscada = _reserva(db_aislada, camping_de_prueba)
    _reserva(db_aislada, camping_de_prueba)
    # En el panel el número es el comienzo del id, como en Mis reservas
    numero = str(buscada.id)[:8].upper()

    resultado = _listar(tokens["ADMIN"], busqueda=f"{prefijo}{numero}")

    assert _ids(resultado) == [str(buscada.id)]


def test_los_comodines_de_la_busqueda_se_toman_como_texto(db_aislada, tokens, camping_de_prueba):
    _reserva(db_aislada, camping_de_prueba, titular="Ana Pérez")

    resultado = _listar(tokens["ADMIN"], busqueda="%")

    assert resultado == {"total": 0, "items": []}


def test_los_filtros_se_combinan(db_aislada, tokens, camping_de_prueba):
    buscada = _reserva(db_aislada, camping_de_prueba, titular="Ana Pérez",
                       estado_reserva=EstadoReservaEnum.CANCELADA)
    _reserva(db_aislada, camping_de_prueba, titular="Ana Pérez")

    datos = _listar(
        tokens["ADMIN"], busqueda="ana", estado_reserva="Cancelada", tipo_cliente="visitante"
    )

    assert _ids(datos) == [str(buscada.id)]


# --- Detalle ---

def test_detalle_con_personas_tipo_pagos_y_sin_ingreso(db_aislada, tokens, camping_de_prueba):
    tipo = TipoReserva(
        nombre=f"Carpa gestión {uuid.uuid4().hex[:6]}",
        precio=Decimal("7500"),
        forma_cobro=FormaCobroEnum.POR_PERSONA,
        max_personas=6,
    )
    db_aislada.add(tipo)
    db_aislada.flush()
    reserva = _reserva(db_aislada, camping_de_prueba, tipo_reserva_id=tipo.id,
                       condiciones=[CondicionPersonaEnum.socio, CondicionPersonaEnum.visitante])
    db_aislada.add(Pago(
        reserva_id=reserva.id,
        mp_payment_id=f"mp-{uuid.uuid4().hex}",
        estado="approved",
        monto=Decimal("15000"),
        moneda="ARS",
        metodo_pago="account_money",
        fecha_aprobacion=datetime.now(timezone.utc),
        respuesta_mp={"status": "approved"},
    ))
    db_aislada.flush()

    response = client.get(f"/reservas/{reserva.id}", headers=_headers(tokens["ADMIN"]))

    assert response.status_code == 200, response.text
    detalle = response.json()
    assert detalle["id"] == str(reserva.id)
    assert detalle["tipo_reserva_nombre"] == tipo.nombre
    assert detalle["tipo_cliente"] == "socio"
    assert [p["condicion"] for p in detalle["personas"]] == ["socio", "visitante"]
    assert len(detalle["pagos"]) == 1
    assert detalle["pagos"][0]["estado"] == "approved"
    assert detalle["pagos"][0]["monto"] == 15000.0
    assert detalle["ya_ingreso"] is False
    assert detalle["fecha_primer_ingreso"] is None


def test_detalle_indica_si_ya_ingreso(db_aislada, tokens, camping_de_prueba):
    reserva = _reserva(db_aislada, camping_de_prueba)
    db_aislada.add(IngresoFisico(
        jti=str(uuid.uuid4()),
        reserva_id=reserva.id,
        dispositivo_id="dispositivo-test",
        fecha_hora_ingreso=datetime.now(timezone.utc),
        tipo_ingreso=TipoIngresoEnum.WEB,
        sincronizado_offline=True,
        cantidad_personas=reserva.cantidad_personas,
        monto_cobrado=Decimal("0"),
    ))
    db_aislada.flush()

    detalle = client.get(f"/reservas/{reserva.id}", headers=_headers(tokens["ADMIN"])).json()

    assert detalle["ya_ingreso"] is True
    assert detalle["fecha_primer_ingreso"] is not None
    assert detalle["tipo_reserva_nombre"] is None
    assert detalle["pagos"] == []


def test_detalle_de_una_reserva_que_no_existe_responde_404(db_aislada, tokens):
    response = client.get(f"/reservas/{uuid.uuid4()}", headers=_headers(tokens["ADMIN"]))

    assert response.status_code == 404


def test_mis_reservas_no_se_confunde_con_el_detalle(db_aislada, tokens):
    # /reservas/mias está declarada antes que /reservas/{id}: un socio sigue viendo las suyas
    response = client.get("/reservas/mias", headers=_headers(tokens["CLIENTE"]))

    assert response.status_code == 200


# --- Permisos ---

def test_sin_token_responde_401(db_aislada):
    assert client.get("/reservas/").status_code == 401
    assert client.get(f"/reservas/{uuid.uuid4()}").status_code == 401


@pytest.mark.parametrize("rol", ["SEGURIDAD", "CLIENTE"])
def test_otro_rol_responde_403(db_aislada, tokens, rol):
    assert client.get("/reservas/", headers=_headers(tokens[rol])).status_code == 403
    assert client.get(f"/reservas/{uuid.uuid4()}", headers=_headers(tokens[rol])).status_code == 403
