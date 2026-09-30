import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from main import app
from core.database import SessionLocal, engine, Base
from models.user import User
from models.reserva import Reserva, EstadoPagoEnum
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum

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

        reserva = Reserva(
            user_id=usuario.id,
            fecha_reserva=datetime.now(timezone.utc) + timedelta(days=1),
            cantidad_personas=2,
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
    assert "no encontrada" in data["errores"][0]


def test_bulk_sync_ingreso_nuevo_se_procesa_correctamente():
    reserva_id = _crear_reserva_de_prueba()
    jti = str(uuid.uuid4())

    payload = {
        "ingresos": [
            {
                "jti": jti,
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
                "jti": str(uuid.uuid4()),
                "reserva_id": reserva_id_1,
                "fecha_escaneo": datetime.now(timezone.utc).isoformat(),
            },
            {
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