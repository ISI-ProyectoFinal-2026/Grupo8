import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from main import app
from core.database import SessionLocal, engine, Base
from models.user import User
from models.reserva import Reserva, EstadoPagoEnum, EstadoReservaEnum
from services.camping_service import obtener_o_crear_camping
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from decimal import Decimal
from typing import Optional

# Aseguramos que las tablas existan, siguiendo el mismo patrón que
# tests/test_reservas.py (operación idempotente).
Base.metadata.create_all(bind=engine)

client = TestClient(app)


def _crear_reserva_de_prueba() -> str:
    """Crea un usuario y una reserva reales en la BD de test, necesarios
    para poder ejercitar el endpoint real de sincronización de ingresos."""
    db = SessionLocal()
    try:
        usuario = User(
            email=f"ingreso_test_{uuid.uuid4()}@grupo8.com",
            password_hash="secreto",
            nombre="Usuario Ingreso Test",
            dni=str(uuid.uuid4().int)[:8],
        )
        db.add(usuario)
        db.commit()
        db.refresh(usuario)

        camping = obtener_o_crear_camping(db)
        manana = (datetime.now(timezone.utc) + timedelta(days=1)).date()
        reserva = Reserva(
            user_id=usuario.id,
            camping_id=camping.camping_id,
            fecha_ingreso=manana,
            fecha_egreso=manana,
            cantidad_personas=2,
            monto_total=10000.0,
            titular=usuario.nombre,
            email=usuario.email,
            estado_reserva=EstadoReservaEnum.CONFIRMADA,
            estado_pago=EstadoPagoEnum.PAGADO,
        )
        db.add(reserva)
        db.commit()
        db.refresh(reserva)
        return str(reserva.id)
    finally:
        db.close()


def test_bulk_sync_reserva_inexistente_queda_en_errores():
    payload = {
        "ingresos": [
            {
                "tipo_ingreso": "QR",
                "dispositivo_id": "dispositivo-test",
                "jti": str(uuid.uuid4()),
                "reserva_id": str(uuid.uuid4()),
                "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
            }
        ]
    }

    response = client.post("/api/v1/ingresos/bulk-sync", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["procesados"] == 0
    assert data["conflictos"] == 0
    assert data["sincronizados_jti"] == []
    assert len(data["errores"]) == 1
    assert "no encontrada" in data["errores"][0]["motivo"]


def test_bulk_sync_ingreso_nuevo_se_procesa_correctamente():
    reserva_id = _crear_reserva_de_prueba()
    jti = str(uuid.uuid4())

    payload = {
        "ingresos": [
            {
                "tipo_ingreso": "QR",
                "jti": jti,
                "dispositivo_id": "dispositivo-test",
                "reserva_id": reserva_id,
                "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
            }
        ]
    }

    response = client.post("/api/v1/ingresos/bulk-sync", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["procesados"] == 1
    assert data["conflictos"] == 0
    assert data["sincronizados_jti"] == [jti]
    assert data["errores"] == []


def test_bulk_sync_ingreso_duplicado_se_marca_como_conflicto():
    reserva_id = _crear_reserva_de_prueba()

    # Simulamos que la reserva ya tiene un ingreso físico registrado,
    # para ejercitar la rama de "Conflicto por Duplicado".
    db = SessionLocal()
    try:
        ingreso_previo = IngresoFisico(
            reserva_id=uuid.UUID(reserva_id),
            fecha_hora_ingreso=datetime.now(timezone.utc),
            tipo_ingreso=TipoIngresoEnum.WEB,
            sincronizado_offline=True,
        )
        db.add(ingreso_previo)
        db.commit()
    finally:
        db.close()

    jti_duplicado = str(uuid.uuid4())
    payload = {
        "ingresos": [
            {
                "tipo_ingreso": "QR",
                "dispositivo_id": "dispositivo-test",
                "jti": jti_duplicado,
                "reserva_id": reserva_id,
                "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
            }
        ]
    }

    response = client.post("/api/v1/ingresos/bulk-sync", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["procesados"] == 0
    assert data["conflictos"] == 1
    assert data["sincronizados_jti"] == [jti_duplicado]
    assert data["errores"] == []


def test_bulk_sync_multiples_ingresos_en_un_solo_batch():
    """Ejercita el loop completo del endpoint con más de un elemento."""
    reserva_id_1 = _crear_reserva_de_prueba()
    reserva_id_2 = _crear_reserva_de_prueba()

    payload = {
        "ingresos": [
            {
                "tipo_ingreso": "QR",
                "dispositivo_id": "dispositivo-test",
                "jti": str(uuid.uuid4()),
                "reserva_id": reserva_id_1,
                "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
            },
            {
                "tipo_ingreso": "QR",
                "dispositivo_id": "dispositivo-test",
                "jti": str(uuid.uuid4()),
                "reserva_id": reserva_id_2,
                "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
            },
        ]
    }

    response = client.post("/api/v1/ingresos/bulk-sync", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["procesados"] == 2
    assert len(data["sincronizados_jti"]) == 2
    
    
URL_SYNC = "/api/v1/ingresos/bulk-sync"


def _item_qr(reserva_id: str, jti: Optional[str] = None) -> dict:
    return {
        "tipo_ingreso": "QR",
        "jti": jti or str(uuid.uuid4()),
        "dispositivo_id": "dispositivo-test",
        "reserva_id": reserva_id,
        "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
    }


def _item_manual(**cambios) -> dict:
    item = {
        "tipo_ingreso": "MANUAL",
        "jti": f"manual-{uuid.uuid4()}",
        "dispositivo_id": "dispositivo-test",
        "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
        "cantidad_personas": 3,
        "monto_cobrado": 4500.50,
        "nombre": "Visitante Efectivo",
        "dni": "30123456",
    }
    item.update(cambios)
    return item


def test_bulk_sync_lote_mixto_guarda_los_validos_y_reporta_el_invalido():
    reserva_id = _crear_reserva_de_prueba()
    qr = _item_qr(reserva_id)
    manual = _item_manual()
    invalido = _item_manual(jti=f"manual-{uuid.uuid4()}", monto_cobrado=-10, nombre="")

    response = client.post(URL_SYNC, json={"ingresos": [qr, manual, invalido]})

    assert response.status_code == 200
    data = response.json()
    assert data["procesados"] == 2
    assert data["conflictos"] == 0
    assert data["sincronizados_jti"] == [qr["jti"], manual["jti"]]
    assert len(data["errores"]) == 1
    assert data["errores"][0]["indice"] == 2
    assert data["errores"][0]["jti"] == invalido["jti"]

    db = SessionLocal()
    try:
        filas = db.query(IngresoFisico).filter(
            IngresoFisico.jti.in_([qr["jti"], manual["jti"], invalido["jti"]])
        ).all()
        por_jti = {f.jti: f for f in filas}
        assert set(por_jti) == {qr["jti"], manual["jti"]}  # el inválido no se guardó
        assert por_jti[qr["jti"]].tipo_ingreso == TipoIngresoEnum.WEB
        assert por_jti[manual["jti"]].tipo_ingreso == TipoIngresoEnum.ESPONTANEO
        assert por_jti[manual["jti"]].cantidad_personas == 3
        assert por_jti[manual["jti"]].monto_cobrado == Decimal("4500.50")
        assert por_jti[manual["jti"]].dni == "30123456"
    finally:
        db.close()


def test_bulk_sync_reenviar_el_mismo_manual_no_lo_duplica():
    manual = _item_manual()

    primera = client.post(URL_SYNC, json={"ingresos": [manual]}).json()
    segunda = client.post(URL_SYNC, json={"ingresos": [manual]})

    assert primera["procesados"] == 1
    assert segunda.status_code == 200
    data = segunda.json()
    assert data["procesados"] == 0
    assert data["sincronizados_jti"] == [manual["jti"]]  # se confirma para que la PWA lo borre
    assert data["errores"] == []

    db = SessionLocal()
    try:
        assert db.query(IngresoFisico).filter(IngresoFisico.jti == manual["jti"]).count() == 1
    finally:
        db.close()