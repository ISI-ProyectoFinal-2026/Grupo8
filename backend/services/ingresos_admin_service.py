"""
Historial de ingresos del panel (26.6): solo lectura de ingresos_fisicos.

Lo que hay en ingresos_fisicos es lo que el servidor aceptó. Los intentos rechazados por QR
clonado o duplicado se guardan aparte, en conflictos_sincronizacion (ver api/ingresos.py),
así que no hace falta filtrarlos: nunca llegan a esta tabla.
"""
from datetime import date
from typing import List, Tuple

from sqlalchemy import case, exists, func
from sqlalchemy.orm import Session

from core.tiempo import limites_dias_negocio
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import Reserva
from models.user import User
from schemas.ingresos_admin import IngresoAdmin, TipoIngresoAdmin
from schemas.reserva import TipoClienteEnum
from services.reservas_admin_service import es_reserva_de_socio

# Rango máximo que se puede consultar de una vez (un trimestre, igual que cobros)
MAX_DIAS_RANGO = 92

_TIPO_INGRESO = {
    TipoIngresoEnum.WEB: TipoIngresoAdmin.web,
    TipoIngresoEnum.ESPONTANEO: TipoIngresoAdmin.manual,
}


def _es_socio():
    """
    Ingreso con reserva: la misma regla que Gestión de reservas (la hizo un socio con la sesión
    iniciada o el titular se cargó como socio). Ingreso manual: el DNI es de un socio activo.
    """
    dni_de_socio = exists().where(
        User.dni == IngresoFisico.dni,
        User.is_socio.is_(True),
        User.activo.is_(True),
    )
    return case(
        (IngresoFisico.reserva_id.isnot(None), es_reserva_de_socio()),
        else_=dni_de_socio,
    )


def listar_ingresos(
    db: Session, desde: date, hasta: date, skip: int = 0, limit: int = 20
) -> Tuple[int, List[IngresoAdmin]]:
    """
    Ingresos aceptados entre los días `desde` y `hasta` de Buenos Aires (ambos incluidos):
    el total y la página pedida, del más nuevo al más viejo.
    """
    inicio, fin = limites_dias_negocio(desde, hasta)
    en_rango = (
        IngresoFisico.fecha_hora_ingreso >= inicio,
        IngresoFisico.fecha_hora_ingreso < fin,
    )

    # El total no necesita la reserva: se cuenta sobre la tabla sola
    total = db.query(func.count(IngresoFisico.id)).filter(*en_rango).scalar() or 0

    filas = (
        db.query(IngresoFisico, _es_socio().label("es_socio"))
        .outerjoin(Reserva, Reserva.id == IngresoFisico.reserva_id)
        .filter(*en_rango)
        # El id desempata los ingresos del mismo instante, así una página no repite ni saltea filas
        .order_by(IngresoFisico.fecha_hora_ingreso.desc(), IngresoFisico.id)
        .offset(skip)
        .limit(limit)
        .all()
    )

    items = [
        IngresoAdmin(
            id=ingreso.id,
            fecha_hora_ingreso=ingreso.fecha_hora_ingreso,
            reserva_id=ingreso.reserva_id,
            personas=ingreso.personas,
            tipo_cliente=TipoClienteEnum.socio if es_socio else TipoClienteEnum.visitante,
            tipo_ingreso=_TIPO_INGRESO[ingreso.tipo_ingreso],
        )
        for ingreso, es_socio in filas
    ]
    return total, items
