from typing import Literal, Optional

from pydantic import BaseModel

from models.reserva import CondicionPersonaEnum

MotivoSocio = Literal["NO_EXISTE", "NO_ES_SOCIO", "CUOTA_VENCIDA"]


class SocioValidacion(BaseModel):
    """Resultado de validar un DNI. Nombre y condición solo se informan si la membresía está vigente."""

    valido: bool
    motivo: Optional[MotivoSocio] = None
    nombre: Optional[str] = None
    condicion: Optional[CondicionPersonaEnum] = None
