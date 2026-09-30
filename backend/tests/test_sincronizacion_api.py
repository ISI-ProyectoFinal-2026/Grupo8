from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_bootstrap_pagina_default():
    """
    Con los valores por defecto (limit=1000), la blacklist mock completa
    (3 elementos) entra en una sola página.
    """
    response = client.get("/api/v1/sincronizacion/bootstrap")

    assert response.status_code == 200
    data = response.json()
    assert data["pagina_actual"] == 1
    assert data["tiene_mas_paginas"] is False
    assert data["blacklist"] == ["1234", "5678", "9999"]
    assert "capacidad_maxima" in data["configuracion"]
    assert "buffer_seguridad" in data["configuracion"]
    assert "clave_publica" in data


def test_bootstrap_paginacion_con_mas_paginas():
    """
    Con limit=1, la blacklist mock (3 elementos) requiere más de una
    página: se ejercita la rama tiene_mas_paginas=True.
    """
    response = client.get("/api/v1/sincronizacion/bootstrap?page=1&limit=1")

    assert response.status_code == 200
    data = response.json()
    assert data["blacklist"] == ["1234"]
    assert data["tiene_mas_paginas"] is True


def test_bootstrap_ultima_pagina():
    """Verifica la página final, donde tiene_mas_paginas vuelve a False."""
    response = client.get("/api/v1/sincronizacion/bootstrap?page=3&limit=1")

    assert response.status_code == 200
    data = response.json()
    assert data["blacklist"] == ["9999"]
    assert data["tiene_mas_paginas"] is False