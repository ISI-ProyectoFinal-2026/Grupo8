import pytest
from pydantic import ValidationError
import jwt
from cryptography.hazmat.primitives import serialization

from security.services import SecurityService
from security.schemas import JWTPayloadSchema
from security.config import settings

# --- Fixtures para Reutilización de Datos (DRY) ---

@pytest.fixture
def valid_payload_data():
    """Retorna un diccionario de datos válidos alineados con JWTPayloadSchema."""
    return {
        "jti": "550e8400-e29b-41d4-a716-446655440000",
        "reserva_id": 104,
        "camping_id": 1,
        "iat": 1783962000,
        "cantidad_personas": 4,
        "typ": "visitante",
        "exp": 1784048400,
        "dat": "2026-07-15"
    }

@pytest.fixture
def test_private_key():
    """Retorna la clave privada de desarrollo cargada desde el entorno."""
    return settings.jwt_private_key

@pytest.fixture
def test_public_key():
    """Retorna la clave pública de desarrollo cargada desde el entorno."""
    return settings.vite_public_key if hasattr(settings, 'vite_public_key') else settings.model_dump().get("vite_public_key")


# --- Casos de Prueba ---

def test_generate_offline_qr_token_success(valid_payload_data, test_private_key):
    """
    Verifica que el token se genere correctamente usando datos válidos
    y que la firma pueda ser verificada matemáticamente.
    """
    # Instanciamos el esquema y el servicio
    payload = JWTPayloadSchema(**valid_payload_data)
    service = SecurityService(private_key=test_private_key)
    
    # Generamos token
    token = service.generate_offline_qr_token(payload)
    assert token is not None
    assert isinstance(token, str)
    
    # Verificamos que el contenido decodificado sea exactamente el que enviamos
    # Obtenemos la clave pública para validar la firma
    # Si de casualidad no está en config, la extraemos directamente en el test de la privada
    public_key_pem = settings.model_dump().get("vite_public_key") or settings.model_dump().get("vite_public_key")
    if not public_key_pem:
        # Fallback dinámico: extraemos clave pública de la privada para el test
        priv_key_obj = serialization.load_pem_private_key(test_private_key.replace("\\n", "\n").encode(), password=None)
        public_key_pem = priv_key_obj.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()

    clean_public_key = public_key_pem.replace("\\n", "\n")
    
    decoded = jwt.decode(token, clean_public_key, algorithms=["ES256"], options={"verify_exp": False})
    assert decoded["jti"] == valid_payload_data["jti"]
    assert decoded["reserva_id"] == valid_payload_data["reserva_id"]
    assert decoded["typ"] == "visitante"


def test_generate_offline_qr_token_fails_when_private_key_missing(valid_payload_data):
    """
    Verifica que el servicio lance ValueError de forma explícitamente controlada
    si no se le provee una clave privada válida.
    """
    payload = JWTPayloadSchema(**valid_payload_data)
    
    # Pasamos explícitamente None como clave para simular su ausencia
    service = SecurityService(private_key=None)
    
    # Mockeamos temporalmente el settings por si tiene clave cargada
    service._private_key = None 
    
    with pytest.raises(ValueError) as exc_info:
        service.generate_offline_qr_token(payload)
        
    assert "La clave privada de seguridad no está configurada" in str(exc_info.value)


def test_payload_validation_fails_with_invalid_data(valid_payload_data):
    """
    Verifica que el esquema de Pydantic impida la creación del payload
    si los datos de entrada violan las restricciones del contrato.
    """
    # Modificamos un dato para forzar la falla de tipo (typ debe ser 'socio' o 'visitante')
    invalid_data = valid_payload_data.copy()
    invalid_data["typ"] = "vip"  # Valor inválido según el tipo Literal

    with pytest.raises(ValidationError) as exc_info:
        JWTPayloadSchema(**invalid_data)
        
    assert "Input should be 'socio' or 'visitante'" in str(exc_info.value)