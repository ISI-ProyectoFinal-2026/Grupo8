import uuid
from decimal import Decimal

import pytest

from core.config import settings
from core.database import Base, SessionLocal, engine
from models.descuento import AplicaDescuentoEnum, Descuento
from models.reserva import CondicionPersonaEnum
from services.pricing_service import PersonaPrecio, PricingService

Base.metadata.create_all(bind=engine)

# La función que lee los descuentos de la base, antes de que los tests la reemplacen
CARGADOR_REAL = PricingService._descuentos_activos

VISITANTE = CondicionPersonaEnum.visitante
SOCIO = CondicionPersonaEnum.socio
BASE = Decimal(str(settings.PRECIO_BASE_POR_PERSONA))


def _socio(pct=20, codigo="socio") -> Descuento:
    return Descuento(
        codigo=codigo, nombre=codigo, aplica_a=AplicaDescuentoEnum.socio, porcentaje=Decimal(str(pct)), activo=True
    )


def _por_edad(codigo, pct, edad_min, edad_max) -> Descuento:
    return Descuento(
        codigo=codigo, nombre=codigo, aplica_a=AplicaDescuentoEnum.edad, porcentaje=Decimal(str(pct)),
        edad_min=edad_min, edad_max=edad_max, activo=True,
    )


def _una_persona(condicion, edad, descuentos):
    return PricingService.calcular_precio([PersonaPrecio(edad, condicion)], descuentos).personas[0]


# ---------- Descuento de socio ----------

def test_un_visitante_paga_el_precio_base_sin_descuento():
    precio = _una_persona(VISITANTE, 30, [_socio(20)])

    assert precio.precio_base == BASE
    assert precio.descuento_pct == 0
    assert precio.descuento_codigo is None
    assert precio.precio_final == BASE


def test_un_socio_recibe_el_descuento_configurado():
    precio = _una_persona(SOCIO, 30, [_socio(20)])

    assert precio.descuento_pct == Decimal("20.00")
    assert precio.descuento_codigo == "socio"
    assert precio.precio_final == BASE * Decimal("0.8")


def test_si_no_hay_descuento_de_socio_el_socio_paga_completo():
    # El administrador puede desactivarlo: entonces no llega a la lista de descuentos activos
    precio = _una_persona(SOCIO, 30, [])

    assert precio.descuento_pct == 0
    assert precio.precio_final == BASE


def test_el_porcentaje_sale_de_la_tabla_y_no_de_la_configuracion(monkeypatch):
    monkeypatch.setattr(settings, "PORCENTAJE_DESCUENTO_SOCIO", 0.9)

    precio = _una_persona(SOCIO, 30, [_socio(10)])

    assert precio.descuento_pct == Decimal("10.00")


def test_un_descuento_del_cien_por_ciento_deja_el_precio_en_cero():
    assert _una_persona(SOCIO, 30, [_socio(100)]).precio_final == 0


# ---------- Descuentos por edad ----------

def test_un_visitante_dentro_del_rango_de_edad_recibe_el_descuento():
    precio = _una_persona(VISITANTE, 8, [_socio(20), _por_edad("menores", 50, 0, 11)])

    assert precio.descuento_codigo == "menores"
    assert precio.descuento_pct == Decimal("50.00")
    assert precio.precio_final == BASE / 2


@pytest.mark.parametrize("edad, corresponde", [(0, True), (11, True), (12, False), (60, False)])
def test_los_limites_de_edad_son_inclusivos(edad, corresponde):
    precio = _una_persona(VISITANTE, edad, [_por_edad("menores", 50, 0, 11)])

    assert (precio.descuento_codigo == "menores") is corresponde


def test_un_descuento_por_edad_tambien_aplica_a_un_socio():
    precio = _una_persona(SOCIO, 70, [_socio(20), _por_edad("mayores", 40, 65, 120)])

    assert precio.descuento_codigo == "mayores"
    assert precio.descuento_pct == Decimal("40.00")


def test_no_se_acumulan_se_aplica_solo_el_mayor():
    # Un socio de 8 años cumple los dos: paga con el 50 %, no con 20 + 50
    precio = _una_persona(SOCIO, 8, [_socio(20), _por_edad("menores", 50, 0, 11)])

    assert precio.descuento_pct == Decimal("50.00")
    assert precio.precio_final == BASE / 2


def test_si_el_de_socio_es_mayor_gana_el_de_socio():
    precio = _una_persona(SOCIO, 8, [_socio(60), _por_edad("menores", 50, 0, 11)])

    assert precio.descuento_codigo == "socio"
    assert precio.descuento_pct == Decimal("60.00")


def test_ante_un_empate_se_elige_el_de_codigo_menor():
    descuentos = [_por_edad("zeta", 30, 0, 120), _por_edad("alfa", 30, 0, 120)]

    assert _una_persona(VISITANTE, 30, descuentos).descuento_codigo == "alfa"


# ---------- Totales ----------

def test_el_total_es_la_suma_de_lo_que_paga_cada_persona():
    personas = [PersonaPrecio(34, SOCIO), PersonaPrecio(8, VISITANTE), PersonaPrecio(61, VISITANTE)]

    cotizacion = PricingService.calcular_precio(personas, [_socio(20)])

    assert [p.precio_final for p in cotizacion.personas] == [BASE * Decimal("0.8"), BASE, BASE]
    assert cotizacion.subtotal == BASE * 3
    assert cotizacion.total == BASE * Decimal("2.8")
    assert cotizacion.descuento_total == BASE * Decimal("0.2")
    assert cotizacion.subtotal - cotizacion.descuento_total == cotizacion.total
    assert cotizacion.cantidad_socios == 1


def test_el_resultado_conserva_el_orden_de_las_personas():
    personas = [PersonaPrecio(8, VISITANTE), PersonaPrecio(34, SOCIO)]

    cotizacion = PricingService.calcular_precio(personas, [_socio(20), _por_edad("menores", 50, 0, 11)])

    assert [p.descuento_codigo for p in cotizacion.personas] == ["menores", "socio"]


def test_el_precio_de_cada_persona_se_redondea_a_dos_decimales_hacia_arriba(monkeypatch):
    # 1000.05 con 50 % de descuento da 500.025, que debe redondearse a 500.03
    monkeypatch.setattr(settings, "PRECIO_BASE_POR_PERSONA", 1000.05)

    precio = _una_persona(SOCIO, 30, [_socio(50)])

    assert precio.precio_final == Decimal("500.03")


def test_se_redondea_por_persona_y_despues_se_suma(monkeypatch):
    # Tres personas a 5.025 cada una: redondeadas dan 5.03 * 3 = 15.09 (redondeando el total daría 15.08)
    monkeypatch.setattr(settings, "PRECIO_BASE_POR_PERSONA", 10.05)
    personas = [PersonaPrecio(30, SOCIO)] * 3

    cotizacion = PricingService.calcular_precio(personas, [_socio(50)])

    assert cotizacion.total == Decimal("15.09")


# ---------- Lectura de los descuentos de la base ----------

def test_se_leen_solo_los_descuentos_activos():
    sufijo = uuid.uuid4().hex[:8]
    activo = _por_edad(f"t143_on_{sufijo}", 5, 0, 10)
    inactivo = _por_edad(f"t143_off_{sufijo}", 5, 0, 10)
    inactivo.activo = False
    db = SessionLocal()
    try:
        db.add_all([activo, inactivo])
        db.commit()

        codigos = {d.codigo for d in CARGADOR_REAL(db)}

        assert activo.codigo in codigos
        assert inactivo.codigo not in codigos
    finally:
        db.query(Descuento).filter(Descuento.codigo.like(f"t143_%_{sufijo}")).delete(synchronize_session=False)
        db.commit()
        db.close()


def test_cotizar_aplica_un_descuento_cargado_en_la_base(monkeypatch):
    # Un descuento del 100 % para todas las edades pasa a ser el mayor de cualquier combinación
    monkeypatch.setattr(PricingService, "_descuentos_activos", staticmethod(CARGADOR_REAL))
    codigo = f"t143_gratis_{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        descuento = _por_edad(codigo, 100, 0, 120)
        db.add(descuento)
        db.commit()

        con_descuento = PricingService.cotizar(db, [PersonaPrecio(30, VISITANTE)])
        descuento.activo = False
        db.commit()
        sin_descuento = PricingService.cotizar(db, [PersonaPrecio(30, VISITANTE)])

        assert con_descuento.total == 0
        assert con_descuento.personas[0].descuento_codigo == codigo
        assert sin_descuento.personas[0].descuento_codigo != codigo
    finally:
        db.query(Descuento).filter(Descuento.codigo == codigo).delete()
        db.commit()
        db.close()
