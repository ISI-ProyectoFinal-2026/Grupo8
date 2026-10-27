from decimal import Decimal, ROUND_HALF_UP
from typing import List, NamedTuple, Optional, Sequence

from sqlalchemy.orm import Session

from core.config import settings
from models.descuento import AplicaDescuentoEnum, Descuento
from models.reserva import CondicionPersonaEnum

DOS_DECIMALES = Decimal("0.01")


class PersonaPrecio(NamedTuple):
    """Lo único que hace falta saber de una persona para calcular lo que paga."""
    edad: int
    condicion: CondicionPersonaEnum


class PrecioPersona(NamedTuple):
    """Lo que se cobra a una persona y cómo se llegó a ese importe."""
    precio_base: Decimal
    descuento_pct: Decimal  # en porcentaje: 20 significa 20 %
    precio_final: Decimal
    descuento_codigo: Optional[str] = None  # None si no se aplicó ningún descuento


class Cotizacion(NamedTuple):
    """Resultado de calcular el precio de una reserva completa."""
    personas: List[PrecioPersona]  # en el mismo orden en que llegaron
    subtotal: Decimal
    descuento_total: Decimal
    total: Decimal
    cantidad_socios: int


class PricingService:
    @staticmethod
    def _descuentos_activos(db: Session) -> List[Descuento]:
        """Los descuentos que el administrador tiene encendidos en este momento."""
        return (
            db.query(Descuento)
            .filter(Descuento.activo.is_(True))
            .order_by(Descuento.codigo)
            .all()
        )

    @staticmethod
    def _descuento_de(persona: PersonaPrecio, descuentos: Sequence[Descuento]) -> Optional[Descuento]:
        """
        El mayor descuento que le corresponde a la persona. No se acumulan: si le tocan
        varios, se usa solo el más alto (y ante un empate, el de código menor).
        """
        aplicables = []
        for descuento in descuentos:
            if descuento.aplica_a == AplicaDescuentoEnum.socio:
                corresponde = persona.condicion == CondicionPersonaEnum.socio
            else:
                corresponde = descuento.edad_min <= persona.edad <= descuento.edad_max
            if corresponde:
                aplicables.append(descuento)
        if not aplicables:
            return None
        return min(aplicables, key=lambda d: (-Decimal(str(d.porcentaje)), d.codigo))

    @staticmethod
    def calcular_precio(personas: Sequence[PersonaPrecio], descuentos: Sequence[Descuento]) -> Cotizacion:
        """
        Calcula lo que paga cada persona y el total de la reserva con los descuentos dados.
        El importe de cada persona se redondea a dos decimales (mitad hacia arriba)
        antes de sumar.
        """
        precio_base = Decimal(str(settings.PRECIO_BASE_POR_PERSONA)).quantize(
            DOS_DECIMALES, rounding=ROUND_HALF_UP
        )

        precios = []
        for persona in personas:
            descuento = PricingService._descuento_de(persona, descuentos)
            pct = Decimal(str(descuento.porcentaje)) if descuento else Decimal(0)
            precios.append(PrecioPersona(
                precio_base=precio_base,
                descuento_pct=pct.quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP),
                precio_final=(precio_base * (100 - pct) / 100).quantize(
                    DOS_DECIMALES, rounding=ROUND_HALF_UP
                ),
                descuento_codigo=descuento.codigo if descuento else None,
            ))

        subtotal = precio_base * len(precios)
        total = sum((p.precio_final for p in precios), Decimal(0))
        return Cotizacion(
            personas=precios,
            subtotal=subtotal,
            descuento_total=subtotal - total,
            total=total,
            cantidad_socios=sum(1 for p in personas if p.condicion == CondicionPersonaEnum.socio),
        )

    @staticmethod
    def cotizar(db: Session, personas: Sequence[PersonaPrecio]) -> Cotizacion:
        """
        Único punto de entrada para saber cuánto cuesta una reserva: lo usan la cotización
        y la creación de la reserva, así el importe mostrado es el mismo que se cobra.
        """
        return PricingService.calcular_precio(personas, PricingService._descuentos_activos(db))
