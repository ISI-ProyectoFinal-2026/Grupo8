from datetime import date
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
    precio_base: Decimal  # importe de la persona antes del descuento, ya multiplicado por las jornadas
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
    jornadas: int = 1  # noches que se cobran por persona (una sola si es visita por el día)


class PrecioUnidad(NamedTuple):
    """Lo que se cobra por una unidad (cabaña) y cómo se llegó a ese importe."""
    precio_base: Decimal  # precio de la unidad × noches, antes del descuento
    descuento_pct: Decimal  # en porcentaje: 20 significa 20 %
    precio_final: Decimal
    descuento_codigo: Optional[str] = None  # None si no se aplicó ningún descuento


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
    def jornadas(fecha_ingreso: Optional[date], fecha_egreso: Optional[date]) -> int:
        """
        Jornadas que se cobran a cada persona: las noches de la estadía, y una sola si se
        viene por el día (0 noches). Sin fechas también se cobra una.
        """
        if fecha_ingreso is None or fecha_egreso is None:
            return 1
        return max((fecha_egreso - fecha_ingreso).days, 1)

    @staticmethod
    def calcular_precio(
        personas: Sequence[PersonaPrecio],
        descuentos: Sequence[Descuento],
        precio_por_persona: Optional[Decimal] = None,
        jornadas: int = 1,
    ) -> Cotizacion:
        """
        Calcula lo que paga cada persona y el total de la reserva con los descuentos dados.
        Cada persona paga precio × jornadas, y el descuento se aplica sobre ese subtotal.
        El importe de cada persona se redondea a dos decimales (mitad hacia arriba)
        antes de sumar. Sin precio_por_persona (reservas sin tipo) se usa PRECIO_BASE_POR_PERSONA.
        """
        if precio_por_persona is None:
            precio_por_persona = Decimal(str(settings.PRECIO_BASE_POR_PERSONA))
        precio_noche = Decimal(str(precio_por_persona)).quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP)
        # Lo que cada persona debería pagar sin descuento: el precio por las jornadas
        precio_base = precio_noche * jornadas

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
            jornadas=jornadas,
        )

    @staticmethod
    def cotizar(
        db: Session,
        personas: Sequence[PersonaPrecio],
        precio_por_persona: Optional[Decimal] = None,
        jornadas: int = 1,
    ) -> Cotizacion:
        """
        Único punto de entrada para saber cuánto cuesta una reserva por persona: lo usan la
        cotización y la creación de la reserva, así el importe mostrado es el mismo que se cobra.
        """
        return PricingService.calcular_precio(
            personas, PricingService._descuentos_activos(db), precio_por_persona, jornadas
        )

    @staticmethod
    def precio_por_unidad(precio_unidad: Decimal, noches: int) -> Decimal:
        """Reserva por unidad (cabaña): precio de la unidad × noches, sin descuentos por persona."""
        return (Decimal(str(precio_unidad)) * noches).quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP)

    @staticmethod
    def cotizar_unidad(db: Session, precio_unidad: Decimal, noches: int, es_socio: bool = False) -> PrecioUnidad:
        """
        Reserva por unidad (cabaña): precio de la unidad × noches. Si el titular es socio se aplica
        el descuento de socio que el administrador tiene activo, con el mismo redondeo que por persona.
        Es el único punto de entrada para la cotización y la creación, así el total mostrado es el que se cobra.
        """
        precio_base = PricingService.precio_por_unidad(precio_unidad, noches)
        descuento = None
        if es_socio:
            # Se reutiliza la regla por persona: los descuentos por edad no aplican a una unidad
            descuento = PricingService._descuento_de(
                PersonaPrecio(edad=0, condicion=CondicionPersonaEnum.socio),
                [d for d in PricingService._descuentos_activos(db) if d.aplica_a == AplicaDescuentoEnum.socio],
            )
        pct = Decimal(str(descuento.porcentaje)) if descuento else Decimal(0)
        return PrecioUnidad(
            precio_base=precio_base,
            descuento_pct=pct.quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP),
            precio_final=(precio_base * (100 - pct) / 100).quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP),
            descuento_codigo=descuento.codigo if descuento else None,
        )
