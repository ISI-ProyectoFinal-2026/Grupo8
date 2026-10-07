import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, Date, DateTime, Enum, ForeignKey, CheckConstraint
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
    telefono = Column(String, nullable=True)  # nullable por las reservas anteriores, el schema lo exige en las nuevas

    estado_reserva = Column(Enum(EstadoReservaEnum), default=EstadoReservaEnum.PENDIENTE, nullable=False)
    estado_pago = Column(Enum(EstadoPagoEnum), default=EstadoPagoEnum.PENDIENTE, nullable=False)

    # Identificador único del QR
    jwt_jti = Column(String, unique=True, index=True, nullable=True)

    __table_args__ = (
        CheckConstraint("fecha_egreso >= fecha_ingreso", name="ck_reservas_egreso_desde_ingreso"),
    )
    
    # NUEVO: Relación bidireccional que fuerza el borrado en cascada a nivel de SQLAlchemy
    ingresos = relationship("IngresoFisico", back_populates="reserva", cascade="all, delete-orphan")

    def marcar_como_pagada(self):
        # Cuando entra el pago la reserva también queda confirmada
        self.estado_pago = EstadoPagoEnum.PAGADO
        self.estado_reserva = EstadoReservaEnum.CONFIRMADA
