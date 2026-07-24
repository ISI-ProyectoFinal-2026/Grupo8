from core.config import settings

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