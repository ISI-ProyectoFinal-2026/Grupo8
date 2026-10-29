from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "API Sistema de Accesos - Grupo 8"
    DATABASE_URL: str

    # "development" (default) | "production". En producción se deshabilitan
    # los endpoints auxiliares de desarrollo (ej: GET /usuarios/prueba).
    ENVIRONMENT: str = "development"
    
    # --- Autenticación Web (Login) ---
    AUTH_SECRET_KEY: str
    # Duración de la sesión: socios y admin en minutos; el guardia en horas (trabaja offline)
    AUTH_TOKEN_EXPIRE_MINUTES: int = 60
    GUARD_TOKEN_EXPIRE_HOURS: int = 168
    
    # --- Criptografía QRs Offline ---
    JWT_PRIVATE_KEY: str
    VITE_PUBLIC_KEY: str
    
    # --- Reglas de Negocio del Camping ---
    # Id del camping al que se asocian las reservas (tiene que existir en configuracion_camping)
    CAMPING_ID: str = "CAMP-MENDOZA-01"
    CAMPING_TOTAL_CAPACITY: int = 50
    CAMPING_OFFLINE_BUFFER: int = 5
    MAX_PERSONAS_POR_RESERVA: int = 10
    MAX_NOCHES_POR_RESERVA: int = 10
    # Minutos que una reserva PENDIENTE sigue ocupando cupo; pasado ese plazo se la considera abandonada
    RESERVA_PENDIENTE_TTL_MINUTES: int = 30

    # --- Tarifas ---
    PRECIO_BASE_POR_PERSONA: float = 5000.0
    PORCENTAJE_DESCUENTO_SOCIO: float = 0.20

    # --- Integraciones Cloud ---
    MERCADOPAGO_ACCESS_TOKEN: str 
    MERCADOPAGO_PUBLIC_KEY: str
    RESEND_API_KEY: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()