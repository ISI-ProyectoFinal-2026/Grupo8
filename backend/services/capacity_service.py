from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from core.config import settings
from models.configuracion import ConfiguracionCamping
from models.reserva import EstadoReservaEnum, Reserva
from services.camping_service import cupo_online


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
            ahora = datetime.now(timezone.utc).replace(tzinfo=None)
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

    def check_availability(
        self,
        espacios_solicitados: int,
        reservas_activas: int,
        configuracion: ConfiguracionCamping,
    ) -> bool:
        """
        Calcula si hay cupo disponible con la configuración guardada del camping:
        capacidad − buffer offline (en personas, redondeado hacia arriba) − reservas activas.
        """
        cupo = cupo_online(configuracion.capacidad_total, configuracion.porcentaje_buffer_offline)
        capacidad_disponible = cupo - reservas_activas

        # Validar si los espacios que pide el usuario superan lo disponible
        if espacios_solicitados > capacidad_disponible:
            raise HTTPException(
                status_code=400,
                detail="No hay cupos suficientes disponibles en el camping."
            )

        return True
