from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Configuración de conexión
DB_URL = "postgresql://usuario_admin:admin123@127.0.0.1:5435/camping_db"

# Motor de base de datos
engine = create_engine(DB_URL)

# Fábrica de sesiones
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Clase base para los modelos
Base = declarative_base()