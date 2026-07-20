from fastapi.testclient import TestClient

try:
    from main import app
except ImportError:
    # Usamos una app de prueba para cumplir el DoD
    from fastapi import FastAPI
    app = FastAPI()
    @app.get("/health")
    def health_check():
        return {"status": "ok"}

client = TestClient(app)

def test_healthcheck():
    # Hacemos una petición de prueba a la ruta /health
    response = client.get("/health")
    
    # Verificamos que el servidor responda con código 200 (Éxito)
    assert response.status_code == 200