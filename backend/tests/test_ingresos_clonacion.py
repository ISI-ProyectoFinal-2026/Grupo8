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
from models.resolucion_alerta import ResolucionAlerta
from models.user import RoleEnum, User
from services.payment_service import payment_service
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import inspect
from core.tiempo import ZONA_NEGOCIO

Base.metadata.create_all(bind=engine)

client = TestClient(app)

URL_SYNC = "/api/v1/ingresos/bulk-sync"
URL_ALERTAS = "/api/v1/admin/alertas"


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
            # Las resoluciones de alertas de esta reserva (las crean los tests de la 16.3)
            db.query(ResolucionAlerta).filter(
                ResolucionAlerta.reserva_id == reserva_id
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


# ---------- Resolver incidentes (16.3) ----------

def _id_de(token: str) -> uuid.UUID:
    return uuid.UUID(jwt.decode(token, settings.AUTH_SECRET_KEY, algorithms=["HS256"])["sub"])


def _crear_alerta(tokens: Dict[str, str], reserva_id: str, dispositivo_clon: str = "dispositivo-B") -> None:
    jti = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-A")])
    _sincronizar(tokens, [_item_qr(reserva_id, jti, dispositivo_clon)])


def _resolver(reserva_id: str, token: str, nota: Optional[str] = None):
    return client.post(
        f"{URL_ALERTAS}/{reserva_id}/resolver",
        json={"nota": nota},
        headers=_headers(token),
    )


def _leer_reserva(reserva_id: str) -> Tuple[EstadoReservaEnum, Optional[EstadoReservaEnum], Optional[datetime]]:
    db = SessionLocal()
    try:
        r = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).one()
        return r.estado_reserva, r.estado_antes_alerta, r.fecha_alerta_clonacion
    finally:
        db.close()


def _resoluciones(reserva_id: str) -> List[ResolucionAlerta]:
    db = SessionLocal()
    try:
        return db.query(ResolucionAlerta).filter(
            ResolucionAlerta.reserva_id == uuid.UUID(reserva_id)
        ).all()
    finally:
        db.close()


def test_la_alerta_guarda_el_estado_anterior_de_la_reserva(tokens, crear_reserva):
    reserva_id = crear_reserva()

    _crear_alerta(tokens, reserva_id)

    estado, antes, _ = _leer_reserva(reserva_id)
    assert estado == EstadoReservaEnum.ALERTA_CLONACION
    assert antes == EstadoReservaEnum.CONFIRMADA


def test_un_segundo_clon_no_pisa_el_estado_anterior(tokens, crear_reserva):
    reserva_id = crear_reserva()
    jti = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-A")])
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-B")])

    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-C")])

    assert _leer_reserva(reserva_id)[1] == EstadoReservaEnum.CONFIRMADA


def test_admin_resuelve_y_la_reserva_vuelve_a_su_estado(tokens, crear_reserva):
    reserva_id = crear_reserva()
    _crear_alerta(tokens, reserva_id)

    response = _resolver(reserva_id, tokens["ADMIN"], "Se verificó en la puerta")

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["reserva_id"] == reserva_id
    assert data["resuelto_por_id"] == str(_id_de(tokens["ADMIN"]))
    assert data["fecha_resolucion"] is not None

    estado, antes, fecha = _leer_reserva(reserva_id)
    assert estado == EstadoReservaEnum.CONFIRMADA
    assert antes is None and fecha is None

    # Ya no aparece en el listado
    listado = client.get(URL_ALERTAS, headers=_headers(tokens["ADMIN"])).json()
    assert reserva_id not in [a["reserva_id"] for a in listado]

    # Y queda registrado quién la resolvió y cuándo
    filas = _resoluciones(reserva_id)
    assert len(filas) == 1
    assert filas[0].resuelto_por_id == _id_de(tokens["ADMIN"])
    assert filas[0].estado_restaurado == EstadoReservaEnum.CONFIRMADA
    assert filas[0].fecha_resolucion is not None
    assert filas[0].fecha_deteccion is not None
    assert filas[0].nota == "Se verificó en la puerta"


def test_resolver_dos_veces_devuelve_409(tokens, crear_reserva):
    reserva_id = crear_reserva()
    _crear_alerta(tokens, reserva_id)
    assert _resolver(reserva_id, tokens["ADMIN"]).status_code == 200

    assert _resolver(reserva_id, tokens["ADMIN"]).status_code == 409
    assert len(_resoluciones(reserva_id)) == 1


def test_resolver_una_reserva_que_no_esta_en_alerta_devuelve_409(tokens, crear_reserva):
    reserva_id = crear_reserva()

    assert _resolver(reserva_id, tokens["ADMIN"]).status_code == 409
    assert _resoluciones(reserva_id) == []


def test_resolver_una_reserva_inexistente_devuelve_404(tokens):
    assert _resolver(str(uuid.uuid4()), tokens["ADMIN"]).status_code == 404


def test_resolver_sin_token_devuelve_401():
    response = client.post(f"{URL_ALERTAS}/{uuid.uuid4()}/resolver", json={})
    assert response.status_code == 401


@pytest.mark.parametrize("rol", ["CLIENTE", "SEGURIDAD"])
def test_resolver_con_roles_que_no_son_admin_devuelve_403_y_no_cambia_nada(rol, tokens, crear_reserva):
    reserva_id = crear_reserva()
    _crear_alerta(tokens, reserva_id)

    assert _resolver(reserva_id, tokens[rol]).status_code == 403

    assert _leer_reserva(reserva_id)[0] == EstadoReservaEnum.ALERTA_CLONACION
    assert _resoluciones(reserva_id) == []


def test_una_reserva_resuelta_puede_volver_a_entrar_en_alerta_y_el_historial_se_conserva(tokens, crear_reserva):
    reserva_id = crear_reserva()
    jti = str(uuid.uuid4())
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-A")])
    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-B")])
    assert _resolver(reserva_id, tokens["ADMIN"]).status_code == 200

    _sincronizar(tokens, [_item_qr(reserva_id, jti, "dispositivo-C")])

    estado, antes, fecha = _leer_reserva(reserva_id)
    assert estado == EstadoReservaEnum.ALERTA_CLONACION
    assert antes == EstadoReservaEnum.CONFIRMADA
    assert fecha is not None  # fecha nueva, la del segundo incidente
    assert _resolver(reserva_id, tokens["ADMIN"]).status_code == 200
    assert len(_resoluciones(reserva_id)) == 2


# ---------- Reglas del modelo (sin base de datos) ----------

@pytest.mark.parametrize(
    "antes, pago, esperado",
    [
        (None, EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA),
        (None, EstadoPagoEnum.PENDIENTE, EstadoReservaEnum.PENDIENTE),
        (EstadoReservaEnum.CONFIRMADA, EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA),
        (EstadoReservaEnum.PENDIENTE, EstadoPagoEnum.PENDIENTE, EstadoReservaEnum.PENDIENTE),
        # el pago entró mientras la reserva estaba en alerta
        (EstadoReservaEnum.PENDIENTE, EstadoPagoEnum.PAGADO, EstadoReservaEnum.CONFIRMADA),
    ],
)
def test_resolver_restaura_el_estado_segun_lo_guardado_y_el_pago(antes, pago, esperado):
    reserva = Reserva(
        estado_reserva=EstadoReservaEnum.ALERTA_CLONACION,
        estado_antes_alerta=antes,
        estado_pago=pago,
    )

    assert reserva.resolver_alerta_clonacion() == esperado
    assert reserva.estado_reserva == esperado
    assert reserva.estado_antes_alerta is None
    assert reserva.fecha_alerta_clonacion is None


def test_resolver_una_reserva_sin_alerta_levanta_error():
    reserva = Reserva(estado_reserva=EstadoReservaEnum.CONFIRMADA)

    with pytest.raises(ValueError):
        reserva.resolver_alerta_clonacion()


def test_marcar_alerta_dos_veces_conserva_el_primer_estado_guardado():
    reserva = Reserva(estado_reserva=EstadoReservaEnum.CONFIRMADA)

    reserva.marcar_alerta_clonacion()
    reserva.marcar_alerta_clonacion()

    assert reserva.estado_antes_alerta == EstadoReservaEnum.CONFIRMADA
    
# ---------- Hora real del escaneo (16.4) ----------

def _hora_guardada(jti: str) -> datetime:
    db = SessionLocal()
    try:
        return db.query(IngresoFisico.fecha_hora_ingreso).filter(IngresoFisico.jti == jti).scalar()
    finally:
        db.close()


def test_la_columna_de_la_hora_de_ingreso_guarda_zona_horaria():
    # Si falla, falta correr alembic upgrade head
    columnas = inspect(engine).get_columns("ingresos_fisicos")
    columna = next(c for c in columnas if c["name"] == "fecha_hora_ingreso")

    assert columna["type"].timezone is True


def test_un_escaneo_de_hace_3_horas_conserva_su_hora_original(tokens, crear_reserva):
    reserva_id = crear_reserva()
    escaneo = datetime.now(timezone.utc) - timedelta(hours=3)
    item = _item_qr(reserva_id)
    item["fecha_escaneo"] = escaneo.isoformat()

    data = _sincronizar(tokens, [item])  # llega ahora, horas después del escaneo

    assert data["procesados"] == 1
    guardada = _hora_guardada(str(item["jti"]))
    assert guardada.utcoffset() is not None
    assert guardada == escaneo  # la misma hora, no la de llegada
    assert datetime.now(timezone.utc) - guardada >= timedelta(hours=3)


@pytest.mark.parametrize(
    "fecha_enviada",
    [
        "2026-10-25T14:30:00.000Z",       # como lo manda toISOString() del navegador
        "2026-10-25T14:30:00+00:00",
        "2026-10-25T11:30:00-03:00",      # la misma hora, escrita en Buenos Aires
    ],
)
def test_el_mismo_instante_se_guarda_igual_sin_importar_como_llegue(fecha_enviada, tokens, crear_reserva):
    item = _item_qr(crear_reserva())
    item["fecha_escaneo"] = fecha_enviada

    _sincronizar(tokens, [item])

    guardada = _hora_guardada(str(item["jti"]))
    assert guardada == datetime(2026, 10, 25, 14, 30, tzinfo=timezone.utc)
    assert guardada.astimezone(ZONA_NEGOCIO).hour == 11


def test_una_fecha_sin_zona_horaria_se_rechaza_y_no_se_guarda(tokens, crear_reserva):
    item = _item_qr(crear_reserva())
    item["fecha_escaneo"] = "2026-10-25T14:30:00"

    data = _sincronizar(tokens, [item])

    assert data["procesados"] == 0
    assert data["sincronizados_jti"] == []
    assert len(data["errores"]) == 1
    assert "zona horaria" in data["errores"][0]["motivo"]
    assert _contar_ingresos(str(item["jti"])) == 0


def test_el_lote_se_procesa_en_el_orden_recibido_y_conserva_cada_hora(tokens, crear_reserva):
    base = datetime.now(timezone.utc) - timedelta(hours=5)
    minutos = (0, 7, 19)  # orden cronológico, como lo manda la cola de la PWA
    items = []
    for m in minutos:
        item = _item_qr(crear_reserva())
        item["fecha_escaneo"] = (base + timedelta(minutes=m)).isoformat()
        items.append(item)

    data = _sincronizar(tokens, items)

    assert data["sincronizados_jti"] == [i["jti"] for i in items]
    horas = [_hora_guardada(str(i["jti"])) for i in items]
    assert horas == [base + timedelta(minutes=m) for m in minutos]
    assert horas == sorted(horas)