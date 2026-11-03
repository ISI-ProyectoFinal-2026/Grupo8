from dataclasses import dataclass
from typing import Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import settings
from models.egreso_fisico import EgresoFisico
from models.ingreso_fisico import IngresoFisico


@dataclass(frozen=True)
class Ocupacion:
    ocupacion_actual: int
    capacidad_maxima: int
    buffer_offline: int  # en personas


def personas_dentro(db: Session) -> int:
    """
    Personas que hay dentro del camping: ingresos aceptados menos egresos.

    Cuenta todos los movimientos y no solo los del día, porque hay estadías de varias noches.
    Los QR clonados no suman porque nunca llegan a ingresos_fisicos (quedan en
    conflictos_sincronizacion). Los ingresos viejos sin cantidad cuentan como 1.
    El valor puede ir atrasado hasta que los guardias sincronicen sus ingresos offline.
    """
    ingresadas = db.query(func.coalesce(func.sum(IngresoFisico.personas), 0)).scalar()
    egresadas = db.query(func.coalesce(func.sum(EgresoFisico.cantidad_personas), 0)).scalar()
    return max(int(ingresadas) - int(egresadas), 0)


def _capacidad_y_buffer() -> Tuple[int, int]:
    # Mientras la 19.1 no esté integrada se leen de settings. Cuando lo esté, salen de
    # configuracion_camping y el buffer pasa de porcentaje a personas acá mismo.
    return settings.CAMPING_TOTAL_CAPACITY, settings.CAMPING_OFFLINE_BUFFER


def obtener_ocupacion(db: Session) -> Ocupacion:
    capacidad, buffer = _capacidad_y_buffer()
    return Ocupacion(
        ocupacion_actual=personas_dentro(db),
        capacidad_maxima=capacidad,
        buffer_offline=buffer,
    )