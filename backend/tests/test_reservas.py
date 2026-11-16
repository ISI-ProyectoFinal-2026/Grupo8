from fastapi.testclient import TestClient
from main import app

# NUEVAS IMPORTACIONES PARA LA BASE DE DATOS
from core.database import engine, Base
from models.reserva import Reserva 
from models.user import User

# Le decimos a SQLAlchemy que cree todas las tablas antes de probar (crea la tabla solo si no existe)
Base.metadata.create_all(bind=engine)

client = TestClient(app)

def test_obtener_reservas(como_admin):
    response = client.get("/reservas/?skip=0&limit=10")
    
    assert response.status_code == 200
    
    # El listado viene paginado: el total y la página pedida
    datos = response.json()
    assert isinstance(datos["total"], int)
    assert isinstance(datos["items"], list)

def test_crear_reserva_sin_datos_completos():
    # Simulamos enviar una reserva pero "olvidando" las personas
    payload_incompleto = {
        "fecha_ingreso": "2026-12-31",
        "fecha_egreso": "2026-12-31",
        "email": "ana@test.com",
        # Faltan las personas intencionalmente
    }
    
    response = client.post("/reservas/", json=payload_incompleto)
    
    # FastAPI (Pydantic) debería frenarlo automáticamente y devolver un error 422 (Unprocessable Entity)
    assert response.status_code == 422