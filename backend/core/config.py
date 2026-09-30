from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "API Sistema de Accesos - Grupo 8"
    DATABASE_URL: str
    
    # --- Autenticación Web (Login) ---
    AUTH_SECRET_KEY: str
    
    # --- Criptografía QRs Offline ---
    JWT_PRIVATE_KEY: str
    JWT_PUBLIC_KEY: str
    
    # --- Reglas de Negocio del Camping ---
    CAMPING_TOTAL_CAPACITY: int = 50
    CAMPING_OFFLINE_BUFFER: int = 5

    # --- Tarifas ---
    PRECIO_BASE_POR_PERSONA: float = 5000.0
    PORCENTAJE_DESCUENTO_SOCIO: float = 0.20

    # --- Integraciones Cloud ---
    MERCADOPAGO_ACCESS_TOKEN: str 
    MERCADOPAGO_PUBLIC_KEY: str
    RESEND_API_KEY: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()