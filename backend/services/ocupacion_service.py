from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.egreso_fisico import EgresoFisico
from models.ingreso_fisico import IngresoFisico
from services.camping_service import buffer_en_personas, obtener_o_crear_camping


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


def obtener_ocupacion(db: Session) -> Ocupacion:
    # Capacidad y buffer salen de la configuración guardada; el buffer se informa en personas
    camping = obtener_o_crear_camping(db)
    return Ocupacion(
        ocupacion_actual=personas_dentro(db),
        capacidad_maxima=camping.capacidad_total,
        buffer_offline=buffer_en_personas(camping.capacidad_total, camping.porcentaje_buffer_offline),
    )
