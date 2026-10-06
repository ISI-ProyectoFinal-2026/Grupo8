import pytest

from core.database import Base, SessionLocal, engine
from models.user import User
from models.reserva import Reserva
from models.ingreso_fisico import IngresoFisico
from models.configuracion import ConfiguracionCamping
from models.conflictos import ConflictosSincronizacion
from services.camping_service import obtener_o_crear_camping


@pytest.fixture(scope="session")
def camping_de_prueba():
    """Las reservas tienen FK al camping, así que tiene que existir en la BD de test.
    Lo piden solo los módulos que insertan reservas."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        return obtener_o_crear_camping(db).camping_id
    finally:
        db.close()
