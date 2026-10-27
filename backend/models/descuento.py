import enum
import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, Enum, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import expression

from core.database import Base


# A quién se le aplica el descuento: a los socios o a un rango de edad
class AplicaDescuentoEnum(str, enum.Enum):
    socio = "socio"
    edad = "edad"


class Descuento(Base):
    __tablename__ = "descuentos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Identificador estable del descuento ("socio", "menores"...). No se modifica una vez creado
    codigo = Column(String, unique=True, index=True, nullable=False)
    nombre = Column(String, nullable=False)
    aplica_a = Column(Enum(AplicaDescuentoEnum, name="aplicadescuentoenum"), nullable=False)
    # Porcentaje entero de descuento: 20 significa 20 %
    porcentaje = Column(Numeric(5, 2), nullable=False)
    # Límites de edad (inclusivos). Solo se completan en los descuentos por edad
    edad_min = Column(Integer, nullable=True)
    edad_max = Column(Integer, nullable=True)
    activo = Column(Boolean, nullable=False, default=True, server_default=expression.true())

    __table_args__ = (
        CheckConstraint("porcentaje >= 0 AND porcentaje <= 100", name="ck_descuentos_porcentaje"),
        CheckConstraint(
            "(aplica_a = 'socio' AND edad_min IS NULL AND edad_max IS NULL) OR "
            "(aplica_a = 'edad' AND edad_min IS NOT NULL AND edad_max IS NOT NULL "
            "AND edad_min >= 0 AND edad_max <= 120 AND edad_min <= edad_max)",
            name="ck_descuentos_edades",
        ),
    )
