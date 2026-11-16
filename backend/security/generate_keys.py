import logging
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

logger = logging.getLogger(__name__)

# El script está en backend/security: dos niveles arriba queda la raíz del repositorio
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ENV_PATH = PROJECT_ROOT / ".env"


def generate_es256_keys() -> None:
    """
    Genera un par de claves de curva elíptica (SECP256R1) para firmar JWTs con el algoritmo ES256.
    Exporta las claves en formato PEM y las agrega al archivo .env de la raíz.
    Es idempotente: si el .env ya tiene claves, no las pisa (invalidaría todos los QR emitidos).
    """
    if ENV_PATH.exists():
        content = ENV_PATH.read_text(encoding="utf-8")
        if "JWT_PRIVATE_KEY=" in content or "VITE_PUBLIC_KEY=" in content:
            logger.warning("Las claves criptográficas ya existen en el archivo .env.")
            logger.warning("Se cancela la ejecución para no invalidar los tokens actuales del entorno.")
            return

    logger.info("Generando par de claves ES256 (curva elíptica P-256)...")

    # SECP256R1 es la curva que exige el algoritmo ES256
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    # Cada clave queda en una sola línea del .env: los saltos de línea se guardan como "\n"
    private_env_safe = private_pem.replace("\n", "\\n")
    public_env_safe = public_pem.replace("\n", "\\n")

    # Modo "a": se agregan al final sin borrar las demás variables del .env
    with open(ENV_PATH, "a", encoding="utf-8") as env_file:
        env_file.write("\n# --- Claves Criptográficas SGIC (Autogeneradas) ---\n")
        env_file.write(f'JWT_PRIVATE_KEY="{private_env_safe}"\n')
        env_file.write(f'VITE_PUBLIC_KEY="{public_env_safe}"\n')

    logger.info("Claves ES256 generadas y guardadas en el archivo .env")
    logger.info("El archivo .env no se sube al repositorio.")


if __name__ == "__main__":
    # Se corre como "python security/generate_keys.py", sin acceso al paquete core:
    # se configura el mismo formato de consola que usan los demás scripts
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    generate_es256_keys()
