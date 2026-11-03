from sqlalchemy import func
from sqlalchemy.orm import Session

from models.egreso_fisico import EgresoFisico
from models.ingreso_fisico import IngresoFisico


def personas_dentro(db: Session) -> int:
    """
    Personas que hay dentro del camping: ingresos aceptados menos egresos.

    Los QR clonados no suman porque nunca llegan a ingresos_fisicos (quedan en
    conflictos_sincronizacion). Los ingresos viejos sin cantidad cuentan como 1.
    El valor puede ir atrasado hasta que los guardias sincronicen sus ingresos offline.
    """
    ingresadas = db.query(func.coalesce(func.sum(IngresoFisico.personas), 0)).scalar()
    egresadas = db.query(func.coalesce(func.sum(EgresoFisico.cantidad_personas), 0)).scalar()
    return max(int(ingresadas) - int(egresadas), 0)