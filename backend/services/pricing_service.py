from decimal import Decimal, ROUND_HALF_UP
from typing import NamedTuple

from core.config import settings

DOS_DECIMALES = Decimal("0.01")


class PrecioPersona(NamedTuple):
    """Lo que se cobra a una persona y cómo se llegó a ese importe."""
    precio_base: Decimal
    descuento_pct: Decimal  # en porcentaje: 20 significa 20 %
    precio_final: Decimal


class PricingService:
    @staticmethod
    def calcular_precio(cantidad_personas: int, es_socio: bool) -> float:
        """
        Calcula el precio total de una reserva aplicando descuentos si corresponde.
        """
        # Consulta de configuración (DoD 2)
        precio_base = settings.PRECIO_BASE_POR_PERSONA
        descuento = settings.PORCENTAJE_DESCUENTO_SOCIO

        # Cálculo del subtotal
        subtotal = precio_base * cantidad_personas

        # Aplicación de descuentos para socios (DoD 3)
        if es_socio:
            monto_descuento = subtotal * descuento
            total = subtotal - monto_descuento
        else:
            total = subtotal

        return total

    @staticmethod
    def calcular_precio_persona(es_socio: bool) -> PrecioPersona:
        """
        Precio de una sola persona según su condición, con las tarifas de configuración.
        El importe final se redondea a dos decimales (mitad hacia arriba).
        """
        precio_base = Decimal(str(settings.PRECIO_BASE_POR_PERSONA))
        # La configuración guarda el descuento como fracción (0.20); acá se maneja en porcentaje
        descuento_pct = Decimal(str(settings.PORCENTAJE_DESCUENTO_SOCIO)) * 100 if es_socio else Decimal(0)

        precio_final = (precio_base * (100 - descuento_pct) / 100).quantize(
            DOS_DECIMALES, rounding=ROUND_HALF_UP
        )
        return PrecioPersona(
            precio_base=precio_base.quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP),
            descuento_pct=descuento_pct.quantize(DOS_DECIMALES, rounding=ROUND_HALF_UP),
            precio_final=precio_final,
        )
