from datetime import date
from pydantic import BaseModel, Field, model_validator
from typing import Literal
from uuid import UUID

# Las fechas del QR viajan como texto ISO (YYYY-MM-DD), sin hora ni zona: son días de calendario
_FECHA_ISO = r"^\d{4}-\d{2}-\d{2}$"

class JWTPayloadSchema(BaseModel):
    """
    Esquema estricto para el payload del código QR offline.
    """
    jti: str = Field(..., description="UUID único del token para evitar escaneos duplicados en la barrera")
    reserva_id: str = Field(..., description="ID de la reserva")
    camping_id: str = Field(..., description="ID del camping (ej: CAMP-MENDOZA-01)")
    iat: int = Field(..., description="Timestamp UNIX de cuándo se generó")
    cantidad_personas: int = Field(..., description="Cantidad de personas autorizadas")
    #Literal asegura que solo viajen estos dos valores exactos
    typ: Literal["socio", "visitante"] = Field(..., description="Tipo de cliente, para que la PWA del guardia sepa qué color o mensaje mostrar.")
    exp: int = Field(..., description="Timestamp UNIX de expiración (ej. fin del día de la reserva)")
    dat: str = Field(..., pattern=_FECHA_ISO, description="Primer día válido del QR: la fecha de ingreso de la reserva (YYYY-MM-DD)")
    egr: str = Field(..., pattern=_FECHA_ISO, description="Último día válido del QR: la fecha de egreso de la reserva (YYYY-MM-DD). Los QR emitidos antes de la 28.1 no lo traen")

    @model_validator(mode="after")
    def _egreso_no_anterior_al_ingreso(self) -> "JWTPayloadSchema":
        # fromisoformat también descarta fechas imposibles (ej. 2026-02-31)
        if date.fromisoformat(self.egr) < date.fromisoformat(self.dat):
            raise ValueError("egr no puede ser anterior a dat")
        return self
