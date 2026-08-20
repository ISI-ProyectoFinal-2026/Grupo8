import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware # Importamos el compresor
from sqlalchemy import text

from core.database import SessionLocal
from core.config import settings

# Importamos los routers
from api.reservas import router as reservas_router
from api.ingresos import router as ingresos_router
from api.sincronizacion import router as sync_router # Importamos router

# Configuración básica del logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Inicializamos la aplicación inyectando el título desde la configuración
app = FastAPI(title=settings.PROJECT_NAME)

# Activamos la compresión Gzip para respuestas mayores a 1000 bytes (DoD)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conectamos los routers a la aplicación
app.include_router(reservas_router)
app.include_router(ingresos_router)
app.include_router(sync_router) # Conectamos endpoint

# Middleware para loggeo de errores (Requisito del DoD)
@app.middleware("http")
async def log_errors_middleware(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Error no manejado en la ruta {request.url.path}: {str(e)}")
        raise e

# Endpoint de bienvenida
@app.get("/")
def root():
    return {"message": "Bienvenido a la API del Sistema de Accesos - Grupo 8"}

# Endpoint de prueba que verifica la base de datos (Requisito del DoD)
@app.get("/health")
async def health_check():
    try:
        # Intentamos ejecutar una consulta simple a PostgreSQL
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return {"status": "ok", "message": "¡El motor de FastAPI está conectado a la BD!"}
    except Exception as e:
        logger.error(f"Fallo en conexión a BD: {e}")
        raise HTTPException(status_code=500, detail="Falló la conexión a la base de datos")