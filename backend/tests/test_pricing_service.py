from services.pricing_service import PricingService
from core.config import settings

def test_calcular_precio_cliente_normal():
    # Simulamos 2 personas que NO son socias (es_socio = False)
    cantidad_personas = 2
    es_socio = False
    
    # El precio esperado debería ser simplemente: Base * 2
    precio_esperado = settings.PRECIO_BASE_POR_PERSONA * cantidad_personas
    
    # Ejecutamos nuestro servicio
    resultado = PricingService.calcular_precio(cantidad_personas, es_socio)
    
    # Verificamos que el cálculo sea correcto
    assert resultado == precio_esperado

def test_calcular_precio_socio():
    # Simulamos 2 personas que SÍ son socias (es_socio = True)
    cantidad_personas = 2
    es_socio = True
    
    # El cálculo esperado: (Base * 2) - 20%
    subtotal = settings.PRECIO_BASE_POR_PERSONA * cantidad_personas
    descuento = subtotal * settings.PORCENTAJE_DESCUENTO_SOCIO
    precio_esperado = subtotal - descuento
    
    # Ejecutamos nuestro servicio
    resultado = PricingService.calcular_precio(cantidad_personas, es_socio)
    
    # Verificamos que se haya aplicado el descuento correctamente
    assert resultado == precio_esperado