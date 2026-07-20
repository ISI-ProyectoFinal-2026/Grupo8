from pydantic import BaseModel, Field
from typing import Literal

class JWTPayloadSchema(BaseModel):
    """
    Esquema estricto para el payload del código QR offline.
    """
    jti: str = Field(..., description="UUID único del token para evitar escaneos duplicados en la barrera")
    reserva_id: int = Field(..., description="ID de la reserva")
    camping_id: int = Field(..., description="ID del camping (útil para el panel multi-camping)")
    iat: int = Field(..., description="Timestamp UNIX de cuándo se generó")
    cantidad_personas: int = Field(..., description="Cantidad de personas autorizadas")
    #Literal asegura que solo viajen estos dos valores exactos
    typ: Literal["socio", "visitante"] = Field(..., description="Tipo de cliente, para que la PWA del guardia sepa qué color o mensaje mostrar.")
    exp: int = Field(..., description="Timestamp UNIX de expiración (ej. fin del día de la reserva)")
    dat: str = Field(..., description="Fecha exacta para la que es válido el QR (formato YYYY-MM-DD)")