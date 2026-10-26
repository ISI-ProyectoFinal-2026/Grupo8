from decimal import Decimal

import pytest

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

def test_calcular_precio_persona_visitante_no_tiene_descuento():
    precio = PricingService.calcular_precio_persona(es_socio=False)

    assert float(precio.precio_base) == settings.PRECIO_BASE_POR_PERSONA
    assert precio.descuento_pct == 0
    assert precio.precio_final == precio.precio_base


def test_calcular_precio_persona_socio_aplica_el_descuento_configurado():
    precio = PricingService.calcular_precio_persona(es_socio=True)

    descuento_pct = settings.PORCENTAJE_DESCUENTO_SOCIO * 100
    esperado = settings.PRECIO_BASE_POR_PERSONA * (1 - settings.PORCENTAJE_DESCUENTO_SOCIO)
    assert float(precio.descuento_pct) == descuento_pct
    assert float(precio.precio_final) == pytest.approx(esperado)


def test_calcular_precio_persona_redondea_a_dos_decimales_hacia_arriba(monkeypatch):
    # 1000.05 con 50 % de descuento da 500.025, que debe redondearse a 500.03
    monkeypatch.setattr(settings, "PRECIO_BASE_POR_PERSONA", 1000.05)
    monkeypatch.setattr(settings, "PORCENTAJE_DESCUENTO_SOCIO", 0.5)

    precio = PricingService.calcular_precio_persona(es_socio=True)

    assert precio.precio_final == Decimal("500.03")
