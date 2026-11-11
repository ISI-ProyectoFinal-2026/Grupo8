from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.config import settings
from core.database import get_db
from core.dependencies import require_role
from models.user import RoleEnum
from services.blacklist_service import listar_reservas_canceladas

# Creamos el router para este módulo y le ponemos una etiqueta para que se vea en Swagger
router = APIRouter(
    prefix="/api/v1/sincronizacion",
    tags=["Sincronización Offline"],
    # La lista de reservas canceladas es para la app del guardia: sin token es 401 y con otro rol, 403
    dependencies=[Depends(require_role(RoleEnum.SEGURIDAD, RoleEnum.ADMIN))],
)

LIMITE_MAXIMO = 1000


@router.get("/bootstrap")
def get_bootstrap_data(
    page: int = Query(1, ge=1, description="Número de página para paginación"),
    limit: int = Query(
        LIMITE_MAXIMO, ge=1, le=LIMITE_MAXIMO,
        description="Límite de registros (máximo 1000 para no saturar red)",
    ),
    db: Session = Depends(get_db),
):
    """
    Endpoint de sincronización inicial (Bootstrap).
    Devuelve la configuración, la clave de validación y la blacklist paginada:
    los ids de las reservas canceladas que egresan hoy o después.
    """
    blacklist, tiene_mas_paginas = listar_reservas_canceladas(db, page, limit)

    return {
        "blacklist": blacklist,
        "configuracion": {
            # Conectamos endpoint directamente a las variables de negocio reales
            "capacidad_maxima": settings.CAMPING_TOTAL_CAPACITY,
            "buffer_seguridad": settings.CAMPING_OFFLINE_BUFFER
        },
        # Usamos la clave secreta definida para el backend
        "clave_publica": settings.VITE_PUBLIC_KEY,
        "pagina_actual": page,
        "tiene_mas_paginas": tiene_mas_paginas
    }
