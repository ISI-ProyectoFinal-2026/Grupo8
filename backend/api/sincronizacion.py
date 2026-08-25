from fastapi import APIRouter, Query
from core.config import settings

# Creamos el router para este módulo y le ponemos una etiqueta para que se vea en Swagger
router = APIRouter(
    prefix="/api/v1/sincronizacion",
    tags=["Sincronización Offline"]
)

@router.get("/bootstrap")
async def get_bootstrap_data(
    page: int = Query(1, description="Número de página para paginación"),
    limit: int = Query(1000, description="Límite de registros (máximo 1000 para no saturar red)")
):
    """
    Endpoint de sincronización inicial (Bootstrap).
    Devuelve la configuración, la clave de validación y la blacklist paginada.
    """
    
    # TODO (Integración BD): 
    # Quien tome la conexión con PostgreSQL debe reemplazar este array estático 
    # por una consulta real que traiga los IDs cancelados de las últimas 72hs.
    mock_blacklist_db = ["1234", "5678", "9999"]
    
    # Lógica matemática de la paginación (DoD 7.2)
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    paginated_blacklist = mock_blacklist_db[start_idx:end_idx]
    
    tiene_mas_paginas = len(mock_blacklist_db) > end_idx
    
    return {
        "blacklist": paginated_blacklist,
        "configuracion": {
            # Conectamos endpoint directamente a las variables de negocio reales
            "capacidad_maxima": settings.CAMPING_TOTAL_CAPACITY,
            "buffer_seguridad": settings.CAMPING_OFFLINE_BUFFER
        },
        # Usamos la clave secreta definida para el backend
        "clave_publica": settings.JWT_SECRET_KEY,
        "pagina_actual": page,
        "tiene_mas_paginas": tiene_mas_paginas
    }