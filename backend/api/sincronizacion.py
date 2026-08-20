from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import List

# Creamos el enrutador
router = APIRouter(prefix="/api/v1/sincronizacion", tags=["Sincronización Offline"])

class SyncBootstrapResponse(BaseModel):
    blacklist: List[str]
    configuracion: dict
    clave_publica: str
    pagina_actual: int
    tiene_mas_paginas: bool

@router.get("/bootstrap", response_model=SyncBootstrapResponse)
def get_bootstrap_data(
    page: int = Query(1, description="Número de página para paginación"),
    limit: int = Query(1000, description="Límite de registros (máximo 1000 para no saturar red)")
):
    # TODO: Conectar con la BD real para traer las canceladas de las últimas 72hs
    return {
        "blacklist": ["1234", "5678", "9999"], 
        "configuracion": {
            "capacidad_maxima": 500,
            "buffer_seguridad": 50
        },
        "clave_publica": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...",
        "pagina_actual": page,
        "tiene_mas_paginas": False
    }