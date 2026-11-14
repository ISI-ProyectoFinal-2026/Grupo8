from pydantic import BaseModel


class OcupacionOut(BaseModel):
    ocupacion_actual: int
    capacidad_maxima: int
    # Lugares que no se venden online y quedan para los ingresos en la puerta (en personas)
    buffer_offline: int


class EsperadosOut(BaseModel):
    # Reservas pagadas cuya estadía incluye hoy y que todavía no ingresaron
    reservas: int
    # Personas de esas reservas
    personas: int
