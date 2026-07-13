import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

# Obtenemos la ruta absoluta de donde está el script actual (modules/security)
SCRIPT_DIR = Path(__file__).resolve().parent

# Subimos dos niveles (modules -> Grupo8) para llegar a la raíz del proyecto
PROJECT_ROOT = SCRIPT_DIR.parent.parent

# Definimos la ruta exacta al .env de la raíz
ENV_PATH = PROJECT_ROOT / ".env"

def generate_es256_keys() -> None:
    """
    Genera un par de claves de curva elíptica (SECP256R1) para firmar JWTs con el algoritmo ES256.
    Exporta las claves en formato PEM y las inyecta de forma segura en el archivo .env.
    Es idempotente: no sobrescribe claves existentes.
    """
    
    # 1. Idempotencia: Verificar si el archivo .env ya existe y contiene las claves
    if ENV_PATH.exists():
        content = ENV_PATH.read_text(encoding="utf-8")
        if "JWT_PRIVATE_KEY=" in content or "VITE_PUBLIC_KEY=" in content:
            print("⚠️ WARNING: Las claves criptográficas ya existen en el archivo .env.")
            print("🛑 Abortando la ejecución para evitar invalidar los tokens actuales del entorno.")
            return

    print("⏳ Generando par de claves ES256 (Curva Elíptica P-256)...")
    
    # 2. Generación Matemática Estándar
    # SECP256R1 es la curva estándar requerida para el algoritmo ES256
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    # 3. Serialización a formato universal PEM (Privacy Enhanced Mail)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode("utf-8")

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("utf-8")

    # Tratamiento de strings para el archivo .env
    # Convertimos los saltos de línea físicos (\n) en literales (\\n) para 
    # que la clave se guarde en una sola línea dentro de las comillas.
    private_env_safe = private_pem.replace("\n", "\\n")
    public_env_safe = public_pem.replace("\n", "\\n")

    # 4. Inyección Segura en Variables de Entorno
    # Usamos el modo "append" ("a") para no borrar otras variables que ya existan en el .env
    with open(ENV_PATH, "a", encoding="utf-8") as env_file:
        env_file.write("\n# --- Claves Criptográficas SGIC (Autogeneradas) ---\n")
        env_file.write(f'JWT_PRIVATE_KEY="{private_env_safe}"\n')
        env_file.write(f'VITE_PUBLIC_KEY="{public_env_safe}"\n')

    print("✅ ÉXITO: Claves ES256 generadas y almacenadas en el archivo .env")
    print("🔒 Recuerda no commitear el archivo .env al repositorio.")

if __name__ == "__main__":
    generate_es256_keys()