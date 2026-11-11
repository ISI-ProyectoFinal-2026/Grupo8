from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from core.config import settings
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva


def _ahora_utc() -> datetime:
    # Como se guarda fecha_reserva: UTC sin zona horaria
    return datetime.now(timezone.utc).replace(tzinfo=None)


def vencimiento_pago(fecha_reserva: datetime) -> datetime:
    """Hasta cuándo se puede pagar una reserva pendiente, en UTC con zona horaria."""
    return fecha_reserva.replace(tzinfo=timezone.utc) + timedelta(minutes=settings.RESERVA_PENDIENTE_TTL_MINUTES)


def plazo_vencido(reserva: Reserva, ahora: Optional[datetime] = None) -> bool:
    """True si la reserva ya no está dentro del plazo de pago: cancelada, o pendiente con el plazo cumplido."""
    if reserva.estado_reserva == EstadoReservaEnum.CANCELADA:
        return True
    if reserva.estado_reserva != EstadoReservaEnum.PENDIENTE:
        return False
    limite = (ahora or _ahora_utc()) - timedelta(minutes=settings.RESERVA_PENDIENTE_TTL_MINUTES)
    return reserva.fecha_reserva < limite


class CapacityService:
    def lugares_ocupados(
        self,
        db: Session,
        fecha_ingreso: date,
        fecha_egreso: date,
        ahora: Optional[datetime] = None,
    ) -> int:
        """
        Cuenta los lugares ocupados por las reservas que se solapan con las fechas pedidas.

        Ocupan cupo las confirmadas, las finalizadas, las que están en alerta de clonación y las
        pendientes que todavía están dentro del plazo (RESERVA_PENDIENTE_TTL_MINUTES), para no
        vender dos veces un lugar mientras se espera el pago. No ocupan cupo las canceladas ni las
        pendientes más antiguas que el plazo, que quedaron abandonadas.

        `ahora` es la hora actual en UTC sin zona horaria (como se guarda fecha_reserva); solo se
        recibe para poder probar los casos límite.
        """
        if ahora is None:
            ahora = _ahora_utc()
        limite_pendientes = ahora - timedelta(minutes=settings.RESERVA_PENDIENTE_TTL_MINUTES)

        ocupa_cupo = or_(
            Reserva.estado_reserva.notin_([EstadoReservaEnum.CANCELADA, EstadoReservaEnum.PENDIENTE]),
            and_(
                Reserva.estado_reserva == EstadoReservaEnum.PENDIENTE,
                Reserva.fecha_reserva >= limite_pendientes,
            ),
        )

        # Dos estadías se solapan si el ingreso de una es <= al egreso de la otra y viceversa
        return db.query(func.sum(Reserva.cantidad_personas)).filter(
            ocupa_cupo,
            Reserva.fecha_ingreso <= fecha_egreso,
            Reserva.fecha_egreso >= fecha_ingreso,
        ).scalar() or 0

    def cancelar_reservas_vencidas(self, db: Session, ahora: Optional[datetime] = None) -> int:
        """
        Pasa a CANCELADA las reservas pendientes de pago que superaron el plazo.

        No depende de una tarea programada: se llama al crear y al consultar reservas.
        Las que están en alerta de clonación no se tocan (su estado no es PENDIENTE).
        Devuelve cuántas se cancelaron.
        """
        limite = (ahora or _ahora_utc()) - timedelta(minutes=settings.RESERVA_PENDIENTE_TTL_MINUTES)
        canceladas = (
            db.query(Reserva)
            .filter(
                Reserva.estado_reserva == EstadoReservaEnum.PENDIENTE,
                Reserva.estado_pago == EstadoPagoEnum.PENDIENTE,
                Reserva.fecha_reserva < limite,
            )
            .update(
                {
                    Reserva.estado_reserva: EstadoReservaEnum.CANCELADA,
                    Reserva.estado_pago: EstadoPagoEnum.CANCELADO,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        return canceladas

    def hay_cupo(self, db: Session, fecha_ingreso: date, fecha_egreso: date, personas: int) -> bool:
        """Igual que check_availability, pero responde True/False en lugar de cortar con un 400."""
        ocupados = self.lugares_ocupados(db, fecha_ingreso, fecha_egreso)
        return personas <= settings.CAMPING_TOTAL_CAPACITY - ocupados - settings.CAMPING_OFFLINE_BUFFER

    def check_availability(self, espacios_solicitados: int, reservas_activas: int) -> bool:
        """
        Calcula si hay cupo disponible considerando la capacidad total, 
        las reservas ya activas y el buffer para reservas offline.
        """
        # Fórmula: Capacidad Total - Reservas Activas - Buffer Offline
        capacidad_disponible = settings.CAMPING_TOTAL_CAPACITY - reservas_activas - settings.CAMPING_OFFLINE_BUFFER
        
        # Validar si los espacios que pide el usuario superan lo disponible
        if espacios_solicitados > capacidad_disponible:
            raise HTTPException(
                status_code=400, 
                detail="No hay cupos suficientes disponibles en el camping."
            )
            
        return True
