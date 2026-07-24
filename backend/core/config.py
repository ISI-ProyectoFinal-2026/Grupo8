from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "API Sistema de Accesos - Grupo 8"
    DATABASE_URL: str = "postgresql://usuario_admin:admin123@127.0.0.1:5435/camping_db"
    JWT_SECRET_KEY: str = "clave_secreta_temporal"
    
    # --- Reglas de Negocio del Camping ---
    CAMPING_TOTAL_CAPACITY: int = 50
    CAMPING_OFFLINE_BUFFER: int = 5

    # --- Tarifas (Sub-issue 5.4) ---
    PRECIO_BASE_POR_PERSONA: float = 5000.0
    PORCENTAJE_DESCUENTO_SOCIO: float = 0.20

    # Esta es la forma nueva y recomendada en Pydantic v2
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()