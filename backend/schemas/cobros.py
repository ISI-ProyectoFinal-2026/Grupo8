from datetime import date
from typing import List

from pydantic import BaseModel

class CobrosDia(BaseModel):
    fecha: date
    efectivo: float
    mercado_pago: float
    total: float

class ResumenCobros(BaseModel):
    desde: date
    hasta: date
    total_efectivo: float
    total_mercado_pago: float
    total: float
    # Un elemento por cada día del rango, también los días sin cobros
    dias: List[CobrosDia]
