from core.database import engine, Base
from sqlalchemy import text

print("Forzando eliminación de toda la base de datos...")
with engine.connect() as conn:
    # El CASCADE borra todas las tablas sin importar las relaciones que tengan
    conn.execute(text("DROP SCHEMA public CASCADE;"))
    conn.execute(text("CREATE SCHEMA public;"))
    conn.commit()

# Importamos los modelos principales
from models.user import User
from models.reserva import Reserva
from models.configuracion import ConfiguracionCamping

print("Creando tablas limpias...")
Base.metadata.create_all(bind=engine)

print("¡Base de datos reseteada con éxito!")