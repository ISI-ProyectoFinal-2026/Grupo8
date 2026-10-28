import uuid
import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, Float, Numeric, String, Date, DateTime, Enum, ForeignKey,
    CheckConstraint, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from core.database import Base

# Estado del pago: ¿se cobró o no?
class EstadoPagoEnum(enum.Enum):
    PENDIENTE = "Pendiente"
    PAGADO = "Pagado"
    CANCELADO = "Cancelado"

# Estado operativo: en qué situación está la reserva, independiente del pago
class EstadoReservaEnum(enum.Enum):
    PENDIENTE = "Pendiente"
    CONFIRMADA = "Confirmada"
    CANCELADA = "Cancelada"
    FINALIZADA = "Finalizada" # no hay nada que la setee todavia.

# Condición de cada persona de la reserva. Se envía y se guarda con el mismo texto.
class CondicionPersonaEnum(str, enum.Enum):
    visitante = "visitante"
    socio = "socio"

class Reserva(Base):
    __tablename__ = "reservas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False)
    camping_id = Column(String, ForeignKey("configuracion_camping.camping_id"), nullable=False)

    # fecha_reserva es el momento en que se hizo la reserva; la estadía son ingreso y egreso
    fecha_reserva = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    fecha_ingreso = Column(Date, index=True, nullable=False)
    fecha_egreso = Column(Date, nullable=False)

    cantidad_personas = Column(Integer, nullable=False)
    monto_total = Column(Float, nullable=False)

    # Datos del titular de la reserva (pueden no coincidir con los del usuario logueado)
    titular = Column(String, nullable=False)
    email = Column(String, nullable=False)
    telefono = Column(String, nullable=True)  # solo lo tienen las reservas anteriores; las nuevas ya no lo piden

    estado_reserva = Column(Enum(EstadoReservaEnum), default=EstadoReservaEnum.PENDIENTE, nullable=False)
    estado_pago = Column(Enum(EstadoPagoEnum), default=EstadoPagoEnum.PENDIENTE, nullable=False)

    # Identificador único del QR
    jwt_jti = Column(String, unique=True, index=True, nullable=True)

    __table_args__ = (
        CheckConstraint("fecha_egreso >= fecha_ingreso", name="ck_reservas_egreso_desde_ingreso"),
    )
    
    # NUEVO: Relación bidireccional que fuerza el borrado en cascada a nivel de SQLAlchemy
    ingresos = relationship("IngresoFisico", back_populates="reserva", cascade="all, delete-orphan")

    # Todas las personas de la reserva, en el orden en que se cargaron (la primera es el titular)
    personas = relationship(
        "ReservaPersona",
        back_populates="reserva",
        cascade="all, delete-orphan",
        order_by="ReservaPersona.orden",
    )

    def marcar_como_pagada(self):
        # Cuando entra el pago la reserva también queda confirmada
        self.estado_pago = EstadoPagoEnum.PAGADO
        self.estado_reserva = EstadoReservaEnum.CONFIRMADA


class ReservaPersona(Base):
    __tablename__ = "reserva_personas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Si se borra la reserva, se borran también sus personas
    reserva_id = Column(
        UUID(as_uuid=True), ForeignKey("reservas.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Posición dentro de la reserva: 0 es el titular
    orden = Column(Integer, nullable=False)

    nombre = Column(String, nullable=False)
    edad = Column(Integer, nullable=False)
    condicion = Column(Enum(CondicionPersonaEnum, name="condicionpersonaenum"), nullable=False)
    # Obligatorio para socios; los visitantes pueden no tenerlo
    dni = Column(String, nullable=True)

    # Foto del precio al momento de reservar: si los precios o descuentos cambian después,
    # estos valores no se tocan
    precio_base = Column(Numeric(12, 2), nullable=False)
    descuento_pct = Column(Numeric(5, 2), nullable=False)
    precio_final = Column(Numeric(12, 2), nullable=False)

    reserva = relationship("Reserva", back_populates="personas")

    __table_args__ = (
        # Un mismo DNI no puede aparecer dos veces en la misma reserva (los NULL no cuentan)
        UniqueConstraint("reserva_id", "dni", name="uq_reserva_personas_reserva_dni"),
        CheckConstraint("edad >= 0 AND edad <= 120", name="ck_reserva_personas_edad"),
        CheckConstraint(
            "descuento_pct >= 0 AND descuento_pct <= 100", name="ck_reserva_personas_descuento_pct"
        ),
    )
