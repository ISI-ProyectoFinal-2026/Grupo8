import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from core.database import SessionLocal
from core.config import settings

# Configuración básica del logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Inicializamos la aplicación inyectando el título desde la configuración
app = FastAPI(title=settings.PROJECT_NAME)

# Configuración de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Middleware para loggeo de errores (Requisito del DoD)
@app.middleware("http")
async def log_errors_middleware(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Error no manejado en la ruta {request.url.path}: {str(e)}")
        raise e

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
        raise HTTPException(status_code=500, detail="Fallo la conexión a la base de datos")