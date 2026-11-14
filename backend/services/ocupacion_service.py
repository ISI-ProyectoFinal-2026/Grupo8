from dataclasses import dataclass
from datetime import date
from typing import Optional

from sqlalchemy import exists, func
from sqlalchemy.orm import Session

from models.egreso_fisico import EgresoFisico
from models.ingreso_fisico import IngresoFisico
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from schemas.reserva import hoy_argentina
from services.camping_service import buffer_en_personas, obtener_o_crear_camping


@dataclass(frozen=True)
class Ocupacion:
    ocupacion_actual: int
    capacidad_maxima: int
    buffer_offline: int  # en personas


@dataclass(frozen=True)
class Esperados:
    reservas: int
    personas: int


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


def obtener_esperados(db: Session, hoy: Optional[date] = None) -> Esperados:
    """
    Reservas web que se esperan hoy y todavía no ingresaron, y cuántas personas suman.

    Cuenta las reservas pagadas y no canceladas cuya estadía incluye hoy (del ingreso al
    egreso, ambos incluidos) y que no tienen ningún ingreso registrado. En cuanto se registra
    el primer escaneo de la reserva, deja de contarse. No se suman a la ocupación actual,
    que solo cuenta a quienes ya entraron.

    "Hoy" es el día de Buenos Aires. Un escaneo hecho sin conexión recién se descuenta
    cuando la PWA lo sincroniza.
    """
    hoy = hoy or hoy_argentina()
    ya_ingreso = exists().where(IngresoFisico.reserva_id == Reserva.id)

    reservas, personas = (
        db.query(
            func.count(Reserva.id),
            func.coalesce(func.sum(Reserva.cantidad_personas), 0),
        )
        .filter(
            Reserva.estado_pago == EstadoPagoEnum.PAGADO,
            Reserva.estado_reserva != EstadoReservaEnum.CANCELADA,
            Reserva.fecha_ingreso <= hoy,
            Reserva.fecha_egreso >= hoy,
            ~ya_ingreso,
        )
        .one()
    )
    return Esperados(reservas=int(reservas), personas=int(personas))
