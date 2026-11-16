"""
Crea (si no existe) el usuario de prueba que usa el frontend para crear reservas.

A diferencia de seed.py / seed_qr.py, este script NO borra nada: se puede
ejecutar todas las veces que haga falta sobre cualquier base de datos.

Uso (desde la carpeta backend):
    python seed_usuario_prueba.py
"""
import logging

from core.database import SessionLocal
from core.logger import configurar_logging
from services.usuario_prueba_service import (
    EMAIL_USUARIO_PRUEBA,
    obtener_o_crear_usuario_prueba,
)

logger = logging.getLogger(__name__)


def run() -> None:
    db = SessionLocal()
    try:
        usuario = obtener_o_crear_usuario_prueba(db)
        logger.info(f"Usuario de prueba listo: {EMAIL_USUARIO_PRUEBA} (id={usuario.id})")
    finally:
        db.close()


if __name__ == "__main__":
    configurar_logging(formato="script")
    run()
