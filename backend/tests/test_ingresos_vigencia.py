"""Sub-issue 28.1: bulk-sync rechaza un ingreso con QR escaneado fuera de la estadía de la reserva.

La estadía de estos tests va del 20 al 22 de diciembre de 2099, así se comprueba también que
se compara contra el día del escaneo (`fecha_escaneo`) y no contra la fecha de hoy.
"""
import uuid
from datetime import date
from typing import Callable, Dict, Iterator, List, Tuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func

from core.database import Base, SessionLocal, engine
from main import app
from models.conflictos import ConflictosSincronizacion
from models.ingreso_fisico import IngresoFisico
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from models.user import User

Base.metadata.create_all(bind=engine)

client = TestClient(app)

# bulk-sync exige rol SEGURIDAD; acá no se prueba la autorización (eso está en test_autorizacion.py)
pytestmark = pytest.mark.usefixtures("como_guardia")

URL_SYNC = "/api/v1/ingresos/bulk-sync"
INGRESO = date(2099, 12, 20)
EGRESO = date(2099, 12, 22)


@pytest.fixture
def crear_reserva(camping_de_prueba: str) -> Iterator[Callable[[], str]]:
    """Factory: usuario + reserva pagada del 20 al 22/12/2099. Se borran al terminar el test."""
    creados: List[Tuple[uuid.UUID, uuid.UUID]] = []

    def _crear() -> str:
        db = SessionLocal()
        try:
            usuario = User(
                email=f"vigencia_{uuid.uuid4()}@grupo8.com",
                password_hash="secreto",
                nombre="Usuario Vigencia",
                dni=str(uuid.uuid4().int)[:8],
            )
            db.add(usuario)
            db.commit()
            db.refresh(usuario)

            reserva = Reserva(
                user_id=usuario.id,
                camping_id=camping_de_prueba,
                fecha_ingreso=INGRESO,
                fecha_egreso=EGRESO,
                cantidad_personas=2,
                monto_total=10000.0,
                titular="Titular Vigencia",
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
            db.query(IngresoFisico).filter(IngresoFisico.reserva_id == reserva_id).delete(synchronize_session=False)
            db.query(Reserva).filter(Reserva.id == reserva_id).delete(synchronize_session=False)
            db.query(User).filter(User.id == usuario_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _item_qr(reserva_id: str, fecha_escaneo: str) -> Dict[str, object]:
    return {
        "tipo_ingreso": "QR",
        "jti": str(uuid.uuid4()),
        "reserva_id": reserva_id,
        "fecha_escaneo": fecha_escaneo,
        "dispositivo_id": "dispositivo-vigencia",
    }


def _sincronizar(items: List[Dict[str, object]]) -> Dict[str, object]:
    response = client.post(URL_SYNC, json={"ingresos": items})
    assert response.status_code == 200, response.text
    return response.json()


def _ingresos_guardados(jti: str) -> int:
    db = SessionLocal()
    try:
        return db.query(func.count(IngresoFisico.id)).filter(IngresoFisico.jti == jti).scalar()
    finally:
        db.close()


def _estado_y_conflictos(reserva_id: str) -> Tuple[EstadoReservaEnum, int]:
    db = SessionLocal()
    try:
        reserva = db.query(Reserva).filter(Reserva.id == uuid.UUID(reserva_id)).one()
        conflictos = db.query(func.count(ConflictosSincronizacion.id)).filter(
            ConflictosSincronizacion.reserva_id == reserva.id
        ).scalar()
        return reserva.estado_reserva, conflictos
    finally:
        db.close()


# Las horas se escriben en Buenos Aires (-03:00) o en UTC, como las manda cada navegador
@pytest.mark.parametrize(
    "fecha_escaneo, se_acepta",
    [
        pytest.param("2099-12-19T23:59:59-03:00", False, id="dia-anterior-ultimo-segundo"),
        pytest.param("2099-12-20T00:00:00-03:00", True, id="primer-dia-primer-segundo"),
        pytest.param("2099-12-21T12:00:00-03:00", True, id="dia-del-medio"),
        pytest.param("2099-12-22T23:59:59-03:00", True, id="ultimo-dia-ultimo-segundo"),
        pytest.param("2099-12-23T00:00:00-03:00", False, id="dia-posterior-primer-segundo"),
        # 22:30 en Argentina ya es el día siguiente en UTC. Comparar con la fecha UTC aceptaría
        # el 19 a las 22:30 (UTC dice 20) y rechazaría el 22 a las 22:30 (UTC dice 23)
        pytest.param("2099-12-23T01:30:00Z", True, id="ultimo-dia-22-30-argentina-llega-en-utc"),
        pytest.param("2099-12-20T01:30:00Z", False, id="dia-anterior-22-30-argentina-llega-en-utc"),
    ],
)
def test_solo_se_acepta_un_qr_escaneado_dentro_de_la_estadia(fecha_escaneo, se_acepta, crear_reserva):
    reserva_id = crear_reserva()
    item = _item_qr(reserva_id, fecha_escaneo)

    data = _sincronizar([item])

    if se_acepta:
        assert data["procesados"] == 1
        assert data["sincronizados_jti"] == [item["jti"]]
        assert data["errores"] == []
        assert _ingresos_guardados(str(item["jti"])) == 1
    else:
        assert data["procesados"] == 0
        assert data["conflictos"] == 0
        assert data["sincronizados_jti"] == []
        assert len(data["errores"]) == 1
        assert data["errores"][0]["jti"] == item["jti"]
        assert "QR fuera de fecha" in data["errores"][0]["motivo"]
        assert _ingresos_guardados(str(item["jti"])) == 0


def test_un_qr_fuera_de_fecha_no_deja_rastro_ni_pone_la_reserva_en_alerta(crear_reserva):
    reserva_id = crear_reserva()

    _sincronizar([_item_qr(reserva_id, "2099-12-19T12:00:00-03:00")])

    # No es una clonación: la reserva sigue como estaba y no se crea ningún conflicto
    assert _estado_y_conflictos(reserva_id) == (EstadoReservaEnum.CONFIRMADA, 0)


def test_el_motivo_dice_el_dia_escaneado_y_la_estadia(crear_reserva):
    data = _sincronizar([_item_qr(crear_reserva(), "2099-12-23T09:00:00-03:00")])

    assert data["errores"][0]["motivo"] == (
        "QR fuera de fecha: se escaneó el 2099-12-23 y la reserva es del 2099-12-20 al 2099-12-22."
    )


def test_un_ingreso_fuera_de_fecha_no_frena_al_resto_del_lote(crear_reserva):
    fuera = _item_qr(crear_reserva(), "2099-12-19T12:00:00-03:00")
    dentro = _item_qr(crear_reserva(), "2099-12-21T12:00:00-03:00")
    ultimo = _item_qr(crear_reserva(), "2099-12-22T10:00:00-03:00")

    data = _sincronizar([fuera, dentro, ultimo])

    assert data["procesados"] == 2
    assert data["sincronizados_jti"] == [dentro["jti"], ultimo["jti"]]
    assert [(e["indice"], e["jti"]) for e in data["errores"]] == [(0, fuera["jti"])]
    assert _ingresos_guardados(str(fuera["jti"])) == 0
    assert _ingresos_guardados(str(dentro["jti"])) == 1
    assert _ingresos_guardados(str(ultimo["jti"])) == 1


def test_reenviar_un_ingreso_ya_aceptado_no_se_vuelve_a_validar(crear_reserva):
    # Es el reintento de un ingreso válido: se confirma de nuevo aunque el lote llegue días después
    item = _item_qr(crear_reserva(), "2099-12-21T12:00:00-03:00")

    primero = _sincronizar([item])
    segundo = _sincronizar([item])

    assert primero["procesados"] == 1
    assert segundo["procesados"] == 0
    assert segundo["sincronizados_jti"] == [item["jti"]]
    assert segundo["errores"] == []
    assert _ingresos_guardados(str(item["jti"])) == 1


def test_el_ingreso_manual_sin_reserva_no_se_ve_afectado():
    item = {
        "tipo_ingreso": "MANUAL",
        "jti": f"manual-{uuid.uuid4()}",
        "fecha_escaneo": "2099-12-19T12:00:00-03:00",
        "cantidad_personas": 1,
        "monto_cobrado": "3500.00",
        "nombre": "Elena Efectivo",
        "dni": "30111222",
        "dispositivo_id": "dispositivo-vigencia",
    }
    try:
        data = _sincronizar([item])

        assert data["procesados"] == 1
        assert data["errores"] == []
    finally:
        db = SessionLocal()
        try:
            db.query(IngresoFisico).filter(IngresoFisico.jti == item["jti"]).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()


@pytest.mark.parametrize(
    "fecha_escaneo, se_acepta",
    [
        pytest.param("2099-12-19T23:59:59-03:00", False, id="dia-anterior"),
        pytest.param("2099-12-20T00:00:00-03:00", True, id="primer-dia"),
        pytest.param("2099-12-23T01:30:00Z", True, id="ultimo-dia-22-30-argentina-llega-en-utc"),
        pytest.param("2099-12-23T00:00:00-03:00", False, id="dia-posterior"),
    ],
)
def test_el_ingreso_manual_con_reserva_tambien_respeta_la_estadia(fecha_escaneo, se_acepta, crear_reserva):
    # 29.1: el guardia carga a mano el código del QR; viaja como MANUAL pero con reserva_id
    reserva_id = crear_reserva()
    item = {
        "tipo_ingreso": "MANUAL",
        "jti": str(uuid.uuid4()),
        "reserva_id": reserva_id,
        "fecha_escaneo": fecha_escaneo,
        "cantidad_personas": 2,
        "monto_cobrado": "0.00",
        "nombre": "Elena Reserva",
        "dni": "30111222",
        "dispositivo_id": "dispositivo-vigencia",
    }

    data = _sincronizar([item])

    if se_acepta:
        assert data["procesados"] == 1
        assert data["errores"] == []
        assert _ingresos_guardados(str(item["jti"])) == 1
    else:
        assert data["procesados"] == 0
        assert len(data["errores"]) == 1
        assert "QR fuera de fecha" in data["errores"][0]["motivo"]
        assert _ingresos_guardados(str(item["jti"])) == 0
