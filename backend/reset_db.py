"""
Borra toda la base y la vuelve a crear desde los modelos, sin migraciones.

Uso (desde la carpeta backend):
    python reset_db.py
"""
import logging

from sqlalchemy import text

from core.database import Base, engine
from core.logger import configurar_logging

logger = logging.getLogger(__name__)


def resetear_base() -> None:
    logger.info("Forzando eliminación de toda la base de datos...")
    with engine.connect() as conn:
        # CASCADE borra todas las tablas sin importar las relaciones que tengan
        conn.execute(text("DROP SCHEMA public CASCADE;"))
        conn.execute(text("CREATE SCHEMA public;"))
        conn.commit()

    # Los modelos tienen que estar importados para que create_all conozca sus tablas
    from models.user import User  # noqa: F401
    from models.reserva import Reserva  # noqa: F401
    from models.configuracion import ConfiguracionCamping  # noqa: F401

    logger.info("Creando tablas limpias...")
    Base.metadata.create_all(bind=engine)
    logger.info("¡Base de datos reseteada con éxito!")


if __name__ == "__main__":
    configurar_logging(formato="script")
    resetear_base()
