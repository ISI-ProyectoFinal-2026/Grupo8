"""
Crea (si no existe) el usuario de prueba que usa el frontend para crear reservas.

A diferencia de seed.py / seed_qr.py, este script NO borra nada: se puede
ejecutar todas las veces que haga falta sobre cualquier base de datos.

Uso (desde la carpeta backend):
    python seed_usuario_prueba.py
"""
from core.database import SessionLocal
from services.usuario_prueba_service import (
    EMAIL_USUARIO_PRUEBA,
    obtener_o_crear_usuario_prueba,
)


def run() -> None:
    db = SessionLocal()
    try:
        usuario = obtener_o_crear_usuario_prueba(db)
        print(f"Usuario de prueba listo: {EMAIL_USUARIO_PRUEBA} (id={usuario.id})")
    finally:
        db.close()


if __name__ == "__main__":
    run()
