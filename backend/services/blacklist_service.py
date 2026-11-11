from datetime import date
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from models.reserva import EstadoReservaEnum, Reserva
from schemas.reserva import hoy_argentina


def listar_reservas_canceladas(
    db: Session, page: int, limit: int, hoy: Optional[date] = None
) -> Tuple[List[str], bool]:
    """
    Ids de las reservas canceladas que todavía podrían presentarse en la entrada:
    las que egresan hoy o después (fecha de Argentina). Las que ya terminaron no hace
    falta mandarlas, porque su QR ya no sirve para ese día.

    Devuelve la página pedida y si hay más páginas. El orden por id es fijo, así las
    páginas no se pisan ni se saltean entre un pedido y el siguiente.
    """
    consulta = (
        db.query(Reserva.id)
        .filter(
            Reserva.estado_reserva == EstadoReservaEnum.CANCELADA,
            Reserva.fecha_egreso >= (hoy or hoy_argentina()),
        )
        .order_by(Reserva.id)
        .offset((page - 1) * limit)
        # Se pide uno de más para saber si hay otra página sin hacer un COUNT aparte
        .limit(limit + 1)
    )
    ids = [str(fila.id) for fila in consulta.all()]
    return ids[:limit], len(ids) > limit
