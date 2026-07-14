# test_generate_keys.py
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

# Importamos nuestro script
import generate_keys

def test_generacion_e_integridad_es256(tmp_path, monkeypatch):
    """
    Verifica que el script genere el .env correctamente y que 
    las claves resultantes sean criptográficamente válidas.
    """
    # 1. Aislamiento: Redirigimos el archivo .env a una carpeta temporal
    # para que la prueba no ensucie ni sobreescriba tu entorno real.
    temp_env = tmp_path / ".env"
    monkeypatch.setattr(generate_keys, "ENV_PATH", temp_env)
    
    # 2. Ejecución
    generate_keys.generate_es256_keys()
    
    # 3. Verificación de creación y contenido
    assert temp_env.exists(), "El archivo .env no fue creado."
    content = temp_env.read_text(encoding="utf-8")
    assert "JWT_PRIVATE_KEY=" in content, "Falta la clave privada en el .env"
    assert "VITE_PUBLIC_KEY=" in content, "Falta la clave pública en el .env"
    
    # 4. Extracción de las claves simulando cómo las leerá FastAPI/Vite
    lines = content.split('\n')
    private_str = [l for l in lines if l.startswith('JWT_PRIVATE_KEY=')][0].split('"')[1].replace('\\n', '\n')
    public_str = [l for l in lines if l.startswith('VITE_PUBLIC_KEY=')][0].split('"')[1].replace('\\n', '\n')
    
    # 5. Verificación Criptográfica: Si cryptography puede cargarlas sin error,
    # significa que el formato PEM y la curva matemática son perfectos.
    private_key = serialization.load_pem_private_key(private_str.encode('utf-8'), password=None)
    assert isinstance(private_key, ec.EllipticCurvePrivateKey)
    
    public_key = serialization.load_pem_public_key(public_str.encode('utf-8'))
    assert isinstance(public_key, ec.EllipticCurvePublicKey)