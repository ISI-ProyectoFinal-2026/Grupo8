from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Inicializamos la aplicación
app = FastAPI(title="API Sistema de Accesos - Grupo 8")

# Configuración básica de CORS (para que el frontend en Vercel pueda hablar con este backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Más adelante, tus compañeros de seguridad cambiarán esto por la URL de Vercel
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Endpoint de prueba (El que necesita el test_healthcheck.py para no fallar)
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "¡El motor de FastAPI está funcionando en la nube!"}
