import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Callable, Dict, Iterator, List, Optional, Tuple

import jwt
import pytest
from fastapi.testclient import TestClient

from core.config import settings
from core.database import Base, SessionLocal, engine
from core.dependencies import get_current_user
from main import app
from models.conflictos import ConflictosSincronizacion
from models.ingreso_fisico import IngresoFisico
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import RoleEnum, User

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL_SYNC = "/api/v1/ingresos/bulk-sync"
URL_ALERTAS = "/admin/alertas-clonacion"


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
    """Un usuario por rol, con su token. Se borran al terminar el módulo."""
    db = SessionLocal()
    ids: Dict[str, uuid.UUID] = {}
    try:
        for rol in (RoleEnum.ADMIN, RoleEnum.SEGURIDAD, RoleEnum.CLIENTE):
            usuario = User(
                email=f"alerta_{rol.name.lower()}_{uuid.uuid4()}@grupo8.com",
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
        db.query(User).filter(User.id.in_(list(ids.values()))).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def crear_reserva(camping_de_prueba: str) -> Iterator[Callable[..., str]]:
    """Factory: crea usuario + reserva confirmada y pagada, y los borra al terminar el test."""
    creados: List[Tuple[uuid.UUID, uuid.UUID]] = []

    def _crear(titular: str = "Titular Prueba") -> str:
        db = SessionLocal()
        try:
            usuario = User(
                email=f"clon_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre="Usuario Clonacion",
                dni=str(uuid.uuid4().int)[:8],
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)

            reserva = Reserva(
                user_id=usuario.id,
                camping_id=camping_de_prueba,
                fecha_ingreso=date(2099, 12, 20),
                fecha_egreso=date(2099, 12, 22),
                cantidad_personas=2,
                monto_total=10000.0,
                titular=titular,
                email=usuario.email,
                estado_reserva=EstadoReservaEnum.CONFIRMADA,
                estado_pago=EstadoPagoEnum.PAGADO,
            )
            db.add(reserva)
            db.commit()
            db.refresh(reserva)
            creados.append((reserva.id, usuario.id))
            return str(reserva.id)
        finally:
            db.close()

    yield _crear

    db = SessionLocal()
    try:
        for reserva_id, usuario_id in creados:
            db.query(ConflictosSincronizacion).filter(
                ConflictosSincronizacion.reserva_id == reserva_id
            ).delete(synchronize_session=False)
            # Primero los ingresos: Postgres no deja borrar una reserva que todavía tiene ingresos
            db.query(IngresoFisico).filter(
                IngresoFisico.reserva_id == reserva_id
            ).delete(synchronize_session=False)
            db.query(Reserva).filter(Reserva.id == reserva_id).delete(synchronize_session=False)
            db.query(User).filter(User.id == usuario_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _item_qr(reserva_id: str, jti: Optional[str] = None, dispositivo: str = "dispositivo-A") -> Dict[str, object]:
    return {
        "tipo_ingreso": "QR",
        "jti": jti or str(uuid.uuid4()),
        "dispositivo_id": "dispositivo-test",
        "reserva_id": reserva_id,
        "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
        "dispositivo_id": dispositivo,
    }


def _sincronizar(tokens: Dict[str, str], items: List[Dict[str, object]]) -> Dict[str, object]:
    response = client.post(URL_SYNC, json={"ingresos": items}, headers=_headers(tokens["SEGURIDAD"]))
    assert response.status_code == 200, response.text
    return response.json()


def _estado_reserva(reserva_id: str) -> Tuple[EstadoReservaEnum, Optional[datetime]]:
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).one()
        return reserva.estado_reserva, reserva.fecha_alerta_clonacion
    finally:
        db.close()


def _contar_ingresos(jti: str) -> int:
    db = SessionLocal()
    try:
        return db.query(IngresoFisico).filter(IngresoFisico.jti == jti).count()
    finally:
        db.close()


def _conflictos(reserva_id: str) -> List[ConflictosSincronizacion]:
    db = SessionLocal()
    try:
        return db.query(ConflictosSincronizacion).filter(
            ConflictosSincronizacion.reserva_id == uuid.UUID(reserva_id)
        ).all()
    finally:
        db.close()


# ---------- Sincronización ----------

def test_jti_nuevo_se_guarda_sin_alerta(tokens, crear_reserva):
    reserva_id = crear_reserva()
    item = _item_qr(reserva_id)

    data = _sincronizar(tokens, [item])

    assert data["procesados"] == 1
    assert data["conflictos"] == 0
    assert data["sincronizados_jti"] == [item["jti"]]
    assert _contar_ingresos(str(item["jti"])) == 1
    assert _estado_reserva(reserva_id)[0] == EstadoReservaEnum.CONFIRMADA
    assert _conflictos(reserva_id) == []


def test_mismo_jti_desde_otro_dispositivo_es_clonacion(tokens, crear_reserva):
    reserva_id = crear_reserva()
    jti = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-A")])

    data = _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-B")])

    assert data["procesados"] == 0
    assert data["conflictos"] == 1
    assert data["sincronizados_jti"] == [jti]  # la PWA lo saca de su cola
    assert data["errores"] == []
    assert _contar_ingresos(jti) == 1  # solo el primero quedó aceptado

    conflictos = _conflictos(reserva_id)
    assert len(conflictos) == 1
    assert conflictos[0].jti_involucrado == jti
    assert conflictos[0].dispositivo_id == "dispositivo-B"

    estado, fecha = _estado_reserva(reserva_id)
    assert estado == EstadoReservaEnum.ALERTA_CLONACION
    assert fecha is not None


def test_reenvio_desde_el_mismo_dispositivo_no_es_alerta(tokens, crear_reserva):
    reserva_id = crear_reserva()
    item = _item_qr(reserva_id, dispositivo="dispositivo-A")
    _sincronizar(tokens, [item])

    data = _sincronizar(tokens, [item])

    assert data["procesados"] == 0
    assert data["conflictos"] == 0
    assert data["sincronizados_jti"] == [item["jti"]]
    assert _contar_ingresos(str(item["jti"])) == 1
    assert _estado_reserva(reserva_id)[0] == EstadoReservaEnum.CONFIRMADA
    assert _conflictos(reserva_id) == []


def test_un_segundo_clon_registra_otro_conflicto_y_conserva_la_fecha(tokens, crear_reserva):
    reserva_id = crear_reserva()
    jti = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-A")])
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-B")])
    fecha_primera = _estado_reserva(reserva_id)[1]

    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-C")])

    assert len(_conflictos(reserva_id)) == 2
    assert _estado_reserva(reserva_id)[1] == fecha_primera


def test_lote_mixto_nuevo_clon_e_invalido(tokens, crear_reserva):
    reserva_nueva = crear_reserva()
    reserva_clonada = crear_reserva()
    jti_clon = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(reserva_clonada, jti_clon, "dispositivo-A")])

    nuevo = _item_qr(reserva_nueva, dispositivo="dispositivo-B")
    clon = _item_qr(reserva_clonada, jti_clon, "dispositivo-B")
    invalido = {"tipo_ingreso": "QR", "jti": str(uuid.uuid4())}  # faltan campos

    data = _sincronizar(tokens, [nuevo, clon, invalido])

    assert data["procesados"] == 1
    assert data["conflictos"] == 1
    assert data["sincronizados_jti"] == [nuevo["jti"], jti_clon]
    assert len(data["errores"]) == 1
    assert data["errores"][0]["indice"] == 2
    assert _estado_reserva(reserva_nueva)[0] == EstadoReservaEnum.CONFIRMADA
    assert _estado_reserva(reserva_clonada)[0] == EstadoReservaEnum.ALERTA_CLONACION


def test_sincronizaciones_concurrentes_aceptan_un_solo_ingreso(tokens, crear_reserva):
    reserva_id = crear_reserva()
    jti = str(uuid.uuid4())
    barrera = threading.Barrier(2)

    def sincronizar(dispositivo: str) -> Dict[str, object]:
        barrera.wait()  # las dos peticiones salen a la vez
        respuesta = TestClient(app).post(
            URL_SYNC,
            json={"ingresos": [_item_qr(reserva_id, jti, dispositivo)]},
            headers=_headers(tokens["SEGURIDAD"]),
        )
        assert respuesta.status_code == 200, respuesta.text
        return respuesta.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        resultados = list(pool.map(sincronizar, ["dispositivo-A", "dispositivo-B"]))

    assert sum(int(r["procesados"]) for r in resultados) == 1
    assert sum(int(r["conflictos"]) for r in resultados) == 1
    assert _contar_ingresos(jti) == 1
    assert _estado_reserva(reserva_id)[0] == EstadoReservaEnum.ALERTA_CLONACION


# ---------- Listado de alertas (permisos y contenido) ----------

def test_listado_sin_token_devuelve_401():
    assert client.get(URL_ALERTAS).status_code == 401


@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
def test_listado_para_roles_que_no_son_admin_devuelve_403(rol, tokens):
    assert client.get(URL_ALERTAS, headers=_headers(tokens[rol])).status_code == 403


def test_admin_lista_solo_las_reservas_en_alerta(tokens, crear_reserva):
    en_alerta = crear_reserva(titular="Titular Clonado")
    sin_alerta = crear_reserva(titular="Titular Normal")
    jti = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(en_alerta, jti, "dispositivo-A")])
    _sincronizar(tokens, [_item_qr(en_alerta, jti, "dispositivo-B")])
    _sincronizar(tokens, [_item_qr(sin_alerta, dispositivo="dispositivo-A")])

    response = client.get(URL_ALERTAS, headers=_headers(tokens["ADMIN"]))

    assert response.status_code == 200
    alertas = {a["reserva_id"]: a for a in response.json()}
    assert en_alerta in alertas
    assert sin_alerta not in alertas
    assert alertas[en_alerta]["titular"] == "Titular Clonado"
    assert alertas[en_alerta]["fecha_alerta_clonacion"] is not None


# ---------- Protección de estado ----------

def test_una_reserva_en_alerta_no_cambia_con_el_pago():
    reserva = Reserva(
        estado_reserva=EstadoReservaEnum.ALERTA_CLONACION,
        estado_pago=EstadoPagoEnum.PENDIENTE,
    )

    reserva.marcar_como_pagada()

    assert reserva.estado_pago == EstadoPagoEnum.PAGADO  # la plata se registra
    assert reserva.estado_reserva == EstadoReservaEnum.ALERTA_CLONACION


@pytest.mark.parametrize("nuevo", [EstadoReservaEnum.CANCELADA, EstadoReservaEnum.CONFIRMADA])
def test_una_reserva_en_alerta_no_se_confirma_ni_se_cancela(nuevo):
    reserva = Reserva(estado_reserva=EstadoReservaEnum.ALERTA_CLONACION)

    assert reserva.cambiar_estado_reserva(nuevo) is False
    assert reserva.estado_reserva == EstadoReservaEnum.ALERTA_CLONACION
    
    
from services.payment_service import payment_service


def test_reconcile_no_pisa_la_alerta(monkeypatch, crear_reserva):
    reserva_id = crear_reserva()
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).one()
        reserva.estado_pago = EstadoPagoEnum.PENDIENTE
        reserva.estado_reserva = EstadoReservaEnum.ALERTA_CLONACION
        db.commit()
    finally:
        db.close()

    class MPFalso:
        def payment(self):
            return self

        def search(self, filtros):
            return {"response": {"results": [{"status": "approved", "id": 123}]}}

    monkeypatch.setattr(payment_service, "mp", MPFalso())

    response = client.get(f"/api/payments/reconcile/{reserva_id}")

    assert response.status_code == 200
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).one()
        assert reserva.estado_pago == EstadoPagoEnum.PAGADO
        assert reserva.estado_reserva == EstadoReservaEnum.ALERTA_CLONACION
    finally:
        db.close()