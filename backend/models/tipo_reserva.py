import enum
import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, Enum, Index, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import expression

from core.database import Base


# Cómo se cobra el tipo: por cada persona, o por cada unidad (cabaña) y por noche
class FormaCobroEnum(str, enum.Enum):
    POR_PERSONA = "POR_PERSONA"
    POR_UNIDAD = "POR_UNIDAD"


class TipoReserva(Base):
    __tablename__ = "tipos_reserva"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nombre = Column(String(80), nullable=False)
    precio = Column(Numeric(10, 2), nullable=False)
    forma_cobro = Column(Enum(FormaCobroEnum, name="formacobroenum"), nullable=False)
    # Máximo de personas de una reserva de este tipo (en la cabaña, su capacidad)
    max_personas = Column(Integer, nullable=False)
    # Unidades disponibles por noche. Vacío = sin límite. Solo lo usan los tipos por unidad
    cantidad_unidades = Column(Integer, nullable=True)
    # Desactivar no borra nada: el tipo deja de ofrecerse, pero las reservas lo conservan
    activo = Column(Boolean, nullable=False, default=True, server_default=expression.true())

    __table_args__ = (
        CheckConstraint("precio > 0", name="ck_tipos_reserva_precio"),
        CheckConstraint("max_personas > 0", name="ck_tipos_reserva_max_personas"),
        CheckConstraint(
            "(forma_cobro = 'POR_PERSONA' AND cantidad_unidades IS NULL) OR "
            "(forma_cobro = 'POR_UNIDAD' AND (cantidad_unidades IS NULL OR cantidad_unidades >= 1))",
            name="ck_tipos_reserva_unidades",
        ),
        # "Cabaña" y "cabaña" son el mismo tipo
        Index("uq_tipos_reserva_nombre", func.lower(nombre), unique=True),
    )
