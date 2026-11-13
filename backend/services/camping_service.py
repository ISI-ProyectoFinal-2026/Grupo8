from typing import Dict

from sqlalchemy.orm import Session

from core.config import settings
from models.configuracion import ConfiguracionCamping

# Buffer que se sugiere en el panel: la web vende hasta el 80 % del cupo y el 20 % queda para la puerta
PORCENTAJE_BUFFER_RECOMENDADO = 20


def configuracion_inicial() -> Dict[str, int]:
    """Valores del .env con los que se crea la configuración la primera vez."""
    return {
        "capacidad_total": settings.CAMPING_TOTAL_CAPACITY,
        "porcentaje_buffer_offline": settings.CAMPING_PORCENTAJE_BUFFER_OFFLINE,
        "max_personas_por_reserva": settings.MAX_PERSONAS_POR_RESERVA,
    }


def obtener_o_crear_camping(db: Session) -> ConfiguracionCamping:
    """
    Devuelve la configuración del camping de Qamp (settings.CAMPING_ID) y la crea
    con los valores del .env si todavía no existe. Las reservas la necesitan
    porque camping_id es una FK. No pisa datos existentes: una vez creada,
    los valores se cambian desde el panel.
    """
    camping = db.query(ConfiguracionCamping).filter(
        ConfiguracionCamping.camping_id == settings.CAMPING_ID
    ).first()
    if camping:
        return camping

    camping = ConfiguracionCamping(
        camping_id=settings.CAMPING_ID,
        precio_base_actual=settings.PRECIO_BASE_POR_PERSONA,
        **configuracion_inicial(),
    )
    db.add(camping)
    db.commit()
    db.refresh(camping)
    return camping


def buffer_en_personas(capacidad_total: int, porcentaje_buffer: int) -> int:
    """Lugares que se guardan para la puerta, redondeado hacia arriba (10 % de 45 = 5)."""
    # División entera redondeando hacia arriba, sin pasar por float
    return -(-capacidad_total * porcentaje_buffer // 100)


def cupo_online(capacidad_total: int, porcentaje_buffer: int) -> int:
    """Lugares que se pueden vender por la web: la capacidad sin el buffer."""
    return capacidad_total - buffer_en_personas(capacidad_total, porcentaje_buffer)


class CantidadPersonasError(ValueError):
    """La reserva supera el máximo de personas configurado."""


def verificar_cantidad_personas(camping: ConfiguracionCamping, cantidad: int) -> None:
    """El máximo por reserva sale de la configuración guardada, no del .env."""
    maximo = camping.max_personas_por_reserva
    if cantidad > maximo:
        raise CantidadPersonasError(f"La cantidad máxima de personas por reserva es {maximo}.")


def actualizar_configuracion(
    db: Session,
    capacidad_total: int,
    porcentaje_buffer_offline: int,
    max_personas_por_reserva: int,
) -> ConfiguracionCamping:
    """Guarda los tres valores juntos. Las reglas entre ellos ya las validó el schema."""
    camping = obtener_o_crear_camping(db)
    camping.capacidad_total = capacidad_total
    camping.porcentaje_buffer_offline = porcentaje_buffer_offline
    camping.max_personas_por_reserva = max_personas_por_reserva
    db.commit()
    db.refresh(camping)
    return camping
