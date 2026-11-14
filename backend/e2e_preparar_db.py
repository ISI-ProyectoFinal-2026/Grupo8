"""
Deja lista la base de datos de las pruebas E2E (Playwright) antes de levantar el backend.

1. Crea la base si no existe.
2. La vacía por completo y aplica todas las migraciones (así quedan los tipos de reserva iniciales).
3. Crea el administrador y el guardia con las credenciales que genera Playwright en cada corrida.

Por seguridad solo trabaja sobre una base cuyo nombre termine en "_e2e":
nunca puede borrar la base de desarrollo por error.

Lo ejecuta Playwright (playwright.config.ts). A mano, desde la carpeta backend:
    DATABASE_URL=... POSTGRES_DB=..._e2e E2E_ADMIN_EMAIL=... python e2e_preparar_db.py
"""
import os
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from core.config import settings


def _variable(nombre: str) -> str:
    valor = os.getenv(nombre, "").strip()
    if not valor:
        sys.exit(f"Falta la variable {nombre}. Este script lo ejecuta Playwright (npm run test:e2e).")
    return valor


def crear_base_si_no_existe(url) -> None:
    # CREATE DATABASE no se puede ejecutar dentro de una transacción
    motor = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with motor.connect() as conexion:
        existe = conexion.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :nombre"), {"nombre": url.database}
        ).scalar()
        if not existe:
            conexion.execute(text(f'CREATE DATABASE "{url.database}"'))
            print(f"Base {url.database} creada.")
    motor.dispose()


def vaciar_y_migrar(url) -> None:
    motor = create_engine(url)
    with motor.begin() as conexion:
        conexion.execute(text("DROP SCHEMA public CASCADE"))
        conexion.execute(text("CREATE SCHEMA public"))
    motor.dispose()
    command.upgrade(Config("alembic.ini"), "head")


def crear_usuarios_de_prueba() -> None:
    # Se importan acá: la sesión tiene que abrirse después de migrar
    from core.database import SessionLocal
    from models.user import RoleEnum, User
    from services.auth_service import hash_password
    from services.camping_service import obtener_o_crear_camping

    db = SessionLocal()
    try:
        obtener_o_crear_camping(db)
        db.add_all([
            User(
                email=_variable("E2E_ADMIN_EMAIL"),
                password_hash=hash_password(_variable("E2E_ADMIN_PASSWORD")),
                nombre="Admin E2E",
                dni="90000001",
                rol=RoleEnum.ADMIN,
            ),
            User(
                email=_variable("E2E_GUARDIA_EMAIL"),
                password_hash=hash_password(_variable("E2E_GUARDIA_PASSWORD")),
                nombre="Guardia E2E",
                dni="90000002",
                rol=RoleEnum.SEGURIDAD,
            ),
        ])
        db.commit()
    finally:
        db.close()


def main() -> None:
    url = make_url(settings.DATABASE_URL)
    if not url.database or not url.database.endswith("_e2e"):
        sys.exit(f"La base '{url.database}' no termina en _e2e: no se toca para no borrar datos reales.")

    crear_base_si_no_existe(url)
    vaciar_y_migrar(url)
    crear_usuarios_de_prueba()
    print(f"Base {url.database} lista para las pruebas E2E.")


if __name__ == "__main__":
    main()
