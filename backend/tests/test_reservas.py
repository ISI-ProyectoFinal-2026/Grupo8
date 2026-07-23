from fastapi.testclient import TestClient
from main import app

# Creamos un cliente de prueba basado en tu aplicación
client = TestClient(app)

def test_obtener_reservas():
    # Simulamos una petición GET al endpoint con paginación por defecto
    response = client.get("/reservas/?skip=0&limit=10")
    
    # Verificamos que la respuesta sea exitosa
    assert response.status_code == 200
    
    # Verificamos que lo que nos devuelva sea una lista
    assert isinstance(response.json(), list)

def test_crear_reserva_sin_datos_completos():
    # Simulamos enviar una reserva pero "olvidando" el user_id
    payload_incompleto = {
        "fecha_reserva": "2026-12-31T10:00:00",
        "cantidad_personas": 4
        # Falta el user_id intencionalmente
    }
    
    response = client.post("/reservas/", json=payload_incompleto)
    
    # FastAPI (Pydantic) debería frenarlo automáticamente y devolver un error 422 (Unprocessable Entity)
    assert response.status_code == 422