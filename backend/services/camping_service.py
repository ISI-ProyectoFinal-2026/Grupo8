from sqlalchemy.orm import Session

from core.config import settings
from models.configuracion import ConfiguracionCamping


def obtener_o_crear_camping(db: Session) -> ConfiguracionCamping:
    """
    Devuelve la configuración del camping de Qamp (settings.CAMPING_ID) y la crea
    con los valores del .env si todavía no existe. Las reservas la necesitan
    porque camping_id es una FK. Se usa en seeds y tests; no pisa datos existentes.
    """
    camping = db.query(ConfiguracionCamping).filter(
        ConfiguracionCamping.camping_id == settings.CAMPING_ID
    ).first()
    if camping:
        return camping

    camping = ConfiguracionCamping(
        camping_id=settings.CAMPING_ID,
        capacidad_total=settings.CAMPING_TOTAL_CAPACITY,
        # porcentaje_buffer_offline es un % de la capacidad; en settings el buffer es absoluto
        porcentaje_buffer_offline=round(settings.CAMPING_OFFLINE_BUFFER * 100 / settings.CAMPING_TOTAL_CAPACITY),
        precio_base_actual=settings.PRECIO_BASE_POR_PERSONA,
    )
    db.add(camping)
    db.commit()
    db.refresh(camping)
    return camping
