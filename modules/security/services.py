import jwt
from typing import Optional
from config import settings
from schemas import JWTPayloadSchema

class SecurityService:
    """
    Servicio de infraestructura de seguridad encargado de la emisión 
    y validación de tokens criptográficos para el SGIC.
    """
    def __init__(self, private_key: Optional[str] = None):
        # Inyección de dependencias: si no se pasa clave, usamos la de la configuración.
        # Esto desacopla el servicio del framework y facilita las pruebas unitarias.
        self._private_key = private_key or settings.jwt_private_key
        self._algorithm = "ES256"

    def generate_offline_qr_token(self, payload: JWTPayloadSchema) -> str:
        """
        Recibe un payload validado de reserva y retorna un token JWT firmado 
        criptográficamente con la clave privada ES256.
        
        Sigue el principio Fail-Fast: valida precondiciones antes de firmar.
        """
        # 1. Validación de precondición: Clave Privada existente
        if not self._private_key or self._private_key == "reemplazar_con_clave_privada":
            raise ValueError("La clave privada de seguridad no está configurada o es inválida.")

        # 2. Formateo seguro del PEM (reemplaza saltos de línea literales)
        clean_key = self._private_key.replace("\\n", "\n")

        try:
            # 3. Firmado asimétrico utilizando la curva elíptica
            token = jwt.encode(
                payload.model_dump(),  # Pydantic exporta a dict nativo de Python
                clean_key,
                algorithm=self._algorithm
            )
            return token
        except Exception as e:
            # Encapsulamos cualquier error criptográfico de bajo nivel
            raise RuntimeError(f"Error crítico durante el firmado criptográfico: {str(e)}")
