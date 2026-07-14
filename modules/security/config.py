from pydantic_settings import BaseSettings, SettingsConfigDict

class SecuritySettings(BaseSettings):
    jwt_private_key: str
    
    # Propiedad opcional para los tests (por si necesitamos validarla)
    vite_public_key: str | None = None
    
    # Busca el .env en la raíz del proyecto (Grupo8)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

# Instanciamos la configuración para importarla en otros archivos
settings = SecuritySettings()