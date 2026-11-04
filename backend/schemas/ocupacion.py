from pydantic import BaseModel


class OcupacionOut(BaseModel):
    ocupacion_actual: int
    capacidad_maxima: int
    # Lugares que no se venden online y quedan para los ingresos en la puerta (en personas)
    buffer_offline: int