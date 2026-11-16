import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text

from core.database import SessionLocal
from core.config import settings
from core.logger import configurar_logging

from api.reservas import router as reservas_router
from api.ingresos import router as ingresos_router
from api.sincronizacion import router as sincronizacion_router
from api.payments import router as payments_router
from api.usuarios import router as usuarios_router
from api.descuentos import router as descuentos_router
from api.auth import router as auth_router
from api.socios import router as socios_router
from api.admin_socios import router as admin_socios_router
from api.admin_alertas import router as admin_alertas_router
from api.egresos import router as egresos_router
from api.ocupacion import router as ocupacion_router
from api.admin_cobros import router as admin_cobros_router
from api.admin_esperados import router as admin_esperados_router
from api.admin_configuracion import router as admin_configuracion_router
from api.tipos_reserva import admin_router as admin_tipos_reserva_router
from api.tipos_reserva import router as tipos_reserva_router

configurar_logging(settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.PROJECT_NAME)

# Comprime respuestas mayores a 1000 bytes para no saturar la red móvil del guardia
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(reservas_router)
app.include_router(ingresos_router)
app.include_router(sincronizacion_router)
app.include_router(payments_router)
app.include_router(usuarios_router)
app.include_router(descuentos_router)
app.include_router(auth_router)
app.include_router(socios_router)
app.include_router(admin_socios_router)
app.include_router(admin_alertas_router)
app.include_router(egresos_router)
app.include_router(ocupacion_router)
app.include_router(admin_cobros_router)
app.include_router(admin_esperados_router)
app.include_router(admin_configuracion_router)
app.include_router(tipos_reserva_router)
app.include_router(admin_tipos_reserva_router)

@app.middleware("http")
async def log_errors_middleware(request: Request, call_next):
    """Registra con su traza cualquier error que no manejó ninguna ruta y lo deja seguir."""
    try:
        return await call_next(request)
    except Exception:
        logger.exception(f"Error no manejado en la ruta {request.url.path}")
        raise

@app.get("/")
def root():
    return {"message": "Bienvenido a la API del Sistema de Accesos - Grupo 8"}

@app.get("/health")
async def health_check():
    """Comprueba que la API responde y que llega a PostgreSQL."""
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return {"status": "ok", "message": "¡El motor de FastAPI está conectado a la BD!"}
    except Exception as e:
        logger.error(f"Fallo en conexión a BD: {e}")
        raise HTTPException(status_code=500, detail="Fallo la conexión a la base de datos")