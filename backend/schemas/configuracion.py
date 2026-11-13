from pydantic import BaseModel, ConfigDict, Field, model_validator

from services.camping_service import cupo_online

# Tope de seguridad para que un número enorme no rompa la columna Integer de la base
CAPACIDAD_MAXIMA_PERMITIDA = 1_000_000
# Tope del plazo de cancelación: más de un año antes del ingreso no tiene sentido
DIAS_CANCELACION_MAXIMO = 365


class ConfiguracionUpdate(BaseModel):
    """Lo que el administrador edita desde el panel. Todos los valores se envían juntos."""

    # strict: rechaza "50", 50.5 y True; solo enteros reales
    capacidad_total: int = Field(strict=True, gt=0, le=CAPACIDAD_MAXIMA_PERMITIDA)
    porcentaje_buffer_offline: int = Field(strict=True, ge=0, le=100)
    max_personas_por_reserva: int = Field(strict=True, gt=0)
    # Días antes del ingreso hasta los que se puede cancelar (0 = hasta el mismo día del ingreso)
    dias_cancelacion: int = Field(strict=True, ge=0, le=DIAS_CANCELACION_MAXIMO)
    # Porcentaje del monto pagado que se devuelve al cancelar
    porcentaje_devolucion: int = Field(strict=True, ge=0, le=100)

    @model_validator(mode="after")
    def validar_maximo_contra_cupo_online(self):
        # Una reserva con el máximo de personas tiene que poder venderse por la web
        cupo = cupo_online(self.capacidad_total, self.porcentaje_buffer_offline)
        if self.max_personas_por_reserva > cupo:
            raise ValueError(
                "El máximo de personas por reserva no puede superar el cupo online "
                f"({cupo} personas: la capacidad menos el buffer)."
            )
        return self


class ConfiguracionOut(BaseModel):
    capacidad_total: int
    porcentaje_buffer_offline: int
    max_personas_por_reserva: int
    dias_cancelacion: int
    porcentaje_devolucion: int
    # Sugerencia que muestra el formulario; no se guarda
    porcentaje_buffer_recomendado: int

    model_config = ConfigDict(from_attributes=True)
