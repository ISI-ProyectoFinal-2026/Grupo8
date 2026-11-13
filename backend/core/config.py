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
    # Cupo, buffer y máximo por reserva se editan desde el panel y se guardan en configuracion_camping.
    # Estos valores solo se usan para crear esa fila la primera vez (migración, seeds y tests).
    CAMPING_TOTAL_CAPACITY: int = 50
    # Porcentaje del cupo que no se vende online y queda para los ingresos en la puerta.
    # El documento del proyecto pide vender hasta el 80 % por la web
    CAMPING_PORCENTAJE_BUFFER_OFFLINE: int = 20
    MAX_PERSONAS_POR_RESERVA: int = 10
    MAX_NOCHES_POR_RESERVA: int = 10
    # Plazo para pagar una reserva PENDIENTE: al vencer libera el cupo, se cancela y el link de pago deja de funcionar
    RESERVA_PENDIENTE_TTL_MINUTES: int = 10
    # Reglas de cancelación: valores iniciales, después se editan desde el panel (Configuración).
    # Se puede cancelar hasta N días antes del ingreso (0 = hasta el mismo día) y se devuelve ese porcentaje
    CAMPING_DIAS_CANCELACION: int = 1
    CAMPING_PORCENTAJE_DEVOLUCION: int = 100

    # --- Tarifas ---
    PRECIO_BASE_POR_PERSONA: float = 5000.0
    PORCENTAJE_DESCUENTO_SOCIO: float = 0.20

    # --- Integraciones Cloud ---
    MERCADOPAGO_ACCESS_TOKEN: str 
    MERCADOPAGO_PUBLIC_KEY: str
    # Clave secreta de los webhooks (Tus integraciones > Webhooks). Sin ella se rechazan todos los avisos.
    MERCADOPAGO_WEBHOOK_SECRET: str = ""
    # Web a la que Mercado Pago devuelve al cliente después de pagar (back_urls)
    FRONTEND_URL: str = "http://localhost:5173"
    # Dirección pública del backend, donde Mercado Pago envía los avisos de pago.
    # Con localhost no se envía notification_url: Mercado Pago no acepta direcciones locales.
    BACKEND_PUBLIC_URL: str = "http://localhost:8000"
    RESEND_API_KEY: str

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()