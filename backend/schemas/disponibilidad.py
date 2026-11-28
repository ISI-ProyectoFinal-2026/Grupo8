from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class LugaresDisponibles(BaseModel):
    """Lugares (personas) ocupados y libres. Solo números: ningún dato de las reservas."""

    ocupados: int
    disponibles: int
    # True si no queda ningún lugar
    completo: bool


class DiaDisponibilidad(LugaresDisponibles):
    fecha: date


class EstadiaDisponibilidad(LugaresDisponibles):
    ingreso: date
    egreso: date


class DisponibilidadResponse(BaseModel):
    # Lugares que se pueden vender por la web (la capacidad sin el buffer de la puerta)
    cupo_maximo: int
    dias: List[DiaDisponibilidad]
    # Solo si se pidió una estadía: con la misma cuenta con la que se valida al reservar
    estadia: Optional[EstadiaDisponibilidad] = None
