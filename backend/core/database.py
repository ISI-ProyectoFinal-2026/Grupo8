import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# 1. Forzamos la carga de las variables de entorno desde el archivo .env
load_dotenv()

# 2. Leemos la URL dinámicamente
DB_URL = os.getenv("DATABASE_URL")

# 3. Medida de seguridad: Si por algún motivo no lee el .env, que nos avise claro y fuerte
if not DB_URL:
    raise ValueError("❌ ERROR CRÍTICO: No se encontró la variable DATABASE_URL en el entorno.")

# Motor de base de datos
engine = create_engine(DB_URL)

# Fábrica de sesiones
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Clase base para los modelos
Base = declarative_base()

# Dependencia para obtener la sesión de la base de datos en los endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()