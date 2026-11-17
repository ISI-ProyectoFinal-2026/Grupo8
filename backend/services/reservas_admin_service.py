"""
Consultas de la pantalla Gestión de reservas del panel (Issue 23.3): el listado con filtros
y paginación, y el detalle de una reserva.
"""
from dataclasses import dataclass
from datetime import date, datetime
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import String, and_, cast, exists, func, or_
from sqlalchemy.orm import Query, Session, selectinload
from sqlalchemy.sql.elements import ColumnElement

from models.ingreso_fisico import IngresoFisico
from models.pago import Pago
from models.reserva import (
    CondicionPersonaEnum,
    EstadoPagoEnum,
    EstadoReservaEnum,
    Reserva,
    ReservaPersona,
)
from models.tipo_reserva import TipoReserva
from schemas.reserva import TipoClienteEnum
from services.alta_socio_service import CON_ACENTO, SIN_ACENTO, normalizar


@dataclass(frozen=True)
class FiltrosReservas:
    estado_pago: Optional[EstadoPagoEnum] = None
    estado_reserva: Optional[EstadoReservaEnum] = None
    # Rango sobre la fecha de ingreso, con ambos extremos incluidos
    fecha_desde: Optional[date] = None
    fecha_hasta: Optional[date] = None
    tipo_cliente: Optional[TipoClienteEnum] = None
    # Titular, email o número de reserva (el comienzo del id, como se muestra en el panel)
    busqueda: Optional[str] = None


@dataclass(frozen=True)
class DetalleReserva:
    reserva: Reserva
    tipo_reserva_nombre: Optional[str]
    pagos: List[Pago]
    fecha_primer_ingreso: Optional[datetime]


def es_reserva_de_socio() -> ColumnElement[bool]:
    """
    Una reserva es de socio si la hizo un socio con la sesión iniciada o si el titular
    (la primera persona) se cargó como socio. Misma regla que ReservaAdmin.tipo_cliente.
    """
    titular_socio = exists().where(
        ReservaPersona.reserva_id == Reserva.id,
        ReservaPersona.orden == 0,
        ReservaPersona.condicion == CondicionPersonaEnum.socio,
    )
    return or_(Reserva.user_id.isnot(None), titular_socio)


def _sin_acentos(columna: ColumnElement[str]) -> ColumnElement[str]:
    """Minúsculas y sin acentos, igual que la búsqueda del padrón de socios."""
    return func.lower(func.translate(columna, CON_ACENTO, SIN_ACENTO))


def _condicion_busqueda(busqueda: str) -> Optional[ColumnElement[bool]]:
    """
    Busca sin importar mayúsculas ni acentos:
    - en el titular, cada palabra en cualquier orden ("perez ana" encuentra a "Ana Pérez");
    - en el email, el texto completo;
    - en el número de reserva, el comienzo del id (con o sin "#").
    """
    texto = normalizar(busqueda.strip().lstrip("#").strip())
    palabras = texto.split()
    if not palabras:
        return None
    titular = _sin_acentos(Reserva.titular)
    return or_(
        and_(*(titular.contains(palabra, autoescape=True) for palabra in palabras)),
        _sin_acentos(Reserva.email).contains(texto, autoescape=True),
        cast(Reserva.id, String).startswith(texto, autoescape=True),
    )


def _aplicar_filtros(query: Query, filtros: FiltrosReservas) -> Query:
    if filtros.estado_pago:
        query = query.filter(Reserva.estado_pago == filtros.estado_pago)
    if filtros.estado_reserva:
        query = query.filter(Reserva.estado_reserva == filtros.estado_reserva)
    if filtros.fecha_desde:
        query = query.filter(Reserva.fecha_ingreso >= filtros.fecha_desde)
    if filtros.fecha_hasta:
        query = query.filter(Reserva.fecha_ingreso <= filtros.fecha_hasta)
    if filtros.tipo_cliente == TipoClienteEnum.socio:
        query = query.filter(es_reserva_de_socio())
    elif filtros.tipo_cliente == TipoClienteEnum.visitante:
        query = query.filter(~es_reserva_de_socio())
    if filtros.busqueda:
        condicion = _condicion_busqueda(filtros.busqueda)
        if condicion is not None:
            query = query.filter(condicion)
    return query


def listar_reservas(
    db: Session, filtros: FiltrosReservas, skip: int = 0, limit: int = 10
) -> Tuple[int, List[Reserva]]:
    """
    Devuelve el total de reservas que cumplen los filtros y la página pedida.
    Las más nuevas primero (por fecha en que se hicieron).
    """
    query = _aplicar_filtros(db.query(Reserva), filtros)
    total = query.count()
    reservas = (
        query.options(selectinload(Reserva.personas))
        .order_by(Reserva.fecha_reserva.desc(), Reserva.id)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return total, reservas


def obtener_detalle(db: Session, reserva_id: UUID) -> Optional[DetalleReserva]:
    """La reserva con su tipo, sus pagos y su primer ingreso. None si no existe."""
    reserva = (
        db.query(Reserva)
        .options(selectinload(Reserva.personas))
        .filter(Reserva.id == reserva_id)
        .first()
    )
    if reserva is None:
        return None

    tipo_nombre = None
    if reserva.tipo_reserva_id is not None:
        tipo_nombre = (
            db.query(TipoReserva.nombre).filter(TipoReserva.id == reserva.tipo_reserva_id).scalar()
        )

    pagos = (
        db.query(Pago)
        .filter(Pago.reserva_id == reserva.id)
        .order_by(Pago.fecha_creacion)
        .all()
    )
    primer_ingreso = (
        db.query(func.min(IngresoFisico.fecha_hora_ingreso))
        .filter(IngresoFisico.reserva_id == reserva.id)
        .scalar()
    )

    return DetalleReserva(
        reserva=reserva,
        tipo_reserva_nombre=tipo_nombre,
        pagos=pagos,
        fecha_primer_ingreso=primer_ingreso,
    )
