from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Dict

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.tiempo import ZONA_NEGOCIO
from models.ingreso_fisico import IngresoFisico
from models.pago import Pago

# Estado con el que Mercado Pago informa un pago acreditado
ESTADO_APROBADO = "approved"

# Rango máximo que se puede consultar de una vez (un trimestre)
MAX_DIAS_RANGO = 92


def _dia_en_argentina(columna):
    # Los instantes se guardan en UTC; el día de un cobro se decide con la hora de Buenos Aires
    return func.date(func.timezone(ZONA_NEGOCIO.key, columna))


def _inicio_del_dia(dia: date) -> datetime:
    return datetime.combine(dia, time.min, tzinfo=ZONA_NEGOCIO)


def _a_float(valor: Decimal) -> float:
    return float(valor.quantize(Decimal("0.01")))


def resumen_cobros(db: Session, desde: date, hasta: date) -> dict:
    """
    Lo cobrado por día entre `desde` y `hasta` (ambos incluidos), separado por medio de pago.

    - Efectivo: monto cobrado en los ingresos manuales, en el día en que se escaneó el ingreso.
    - Mercado Pago: solo pagos aprobados, en el día de la aprobación. Si un pago se
      reembolsa, Mercado Pago cambia su estado y deja de contarse.
    """
    inicio = _inicio_del_dia(desde)
    fin = _inicio_del_dia(hasta + timedelta(days=1))

    dia_ingreso = _dia_en_argentina(IngresoFisico.fecha_hora_ingreso)
    efectivo_por_dia: Dict[date, Decimal] = dict(
        db.query(dia_ingreso, func.sum(IngresoFisico.monto_cobrado))
        .filter(
            IngresoFisico.monto_cobrado.isnot(None),
            IngresoFisico.fecha_hora_ingreso >= inicio,
            IngresoFisico.fecha_hora_ingreso < fin,
        )
        .group_by(dia_ingreso)
        .all()
    )

    # Un pago aprobado siempre debería traer fecha de aprobación; si no, se usa la de creación
    fecha_pago = func.coalesce(Pago.fecha_aprobacion, Pago.fecha_creacion)
    dia_pago = _dia_en_argentina(fecha_pago)
    mercado_pago_por_dia: Dict[date, Decimal] = dict(
        db.query(dia_pago, func.sum(Pago.monto))
        .filter(
            Pago.estado == ESTADO_APROBADO,
            Pago.monto.isnot(None),
            fecha_pago >= inicio,
            fecha_pago < fin,
        )
        .group_by(dia_pago)
        .all()
    )

    dias = []
    total_efectivo = Decimal("0")
    total_mercado_pago = Decimal("0")
    dia = desde
    while dia <= hasta:
        efectivo = efectivo_por_dia.get(dia) or Decimal("0")
        mercado_pago = mercado_pago_por_dia.get(dia) or Decimal("0")
        dias.append({
            "fecha": dia,
            "efectivo": _a_float(efectivo),
            "mercado_pago": _a_float(mercado_pago),
            "total": _a_float(efectivo + mercado_pago),
        })
        total_efectivo += efectivo
        total_mercado_pago += mercado_pago
        dia += timedelta(days=1)

    return {
        "desde": desde,
        "hasta": hasta,
        "total_efectivo": _a_float(total_efectivo),
        "total_mercado_pago": _a_float(total_mercado_pago),
        "total": _a_float(total_efectivo + total_mercado_pago),
        "dias": dias,
    }
