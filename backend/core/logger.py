"""
Configuración central del logging del backend.

Cada módulo pide su logger con ``logging.getLogger(__name__)`` y no configura nada:
el formato, el nivel y la salida se deciden en un solo lugar, acá.

Hay dos formatos:

* ``servidor``: fecha, nivel, módulo y mensaje. Es el de la API (main.py). Cada línea se puede
  filtrar por nivel o por módulo en los registros de Render o de cualquier servicio de monitoreo.
* ``script``: solo el mensaje. Es el de los scripts que se corren a mano (seed, reset_db, ...):
  quien los ejecuta lee la terminal como antes, pero los mensajes ya pasan por logging.

Todo sale por la salida estándar de errores (stderr), que es lo que capturan uvicorn, Docker y
las plataformas en la nube. Los loggers propios de uvicorn no se tocan.
"""
import logging
import logging.config
from typing import Literal

Formato = Literal["servidor", "script"]

_FORMATOS: dict[Formato, str] = {
    "servidor": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    "script": "%(message)s",
}

_NIVELES_VALIDOS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


def configurar_logging(nivel: str = "INFO", formato: Formato = "servidor") -> None:
    """Configura el logger raíz. Un nivel desconocido usa INFO para no frenar el arranque."""
    nivel = nivel.upper()
    if nivel not in _NIVELES_VALIDOS:
        nivel = "INFO"

    logging.config.dictConfig(
        {
            "version": 1,
            # Los loggers ya creados (uvicorn, SQLAlchemy, los de cada módulo) siguen funcionando
            "disable_existing_loggers": False,
            "formatters": {
                "qamp": {"format": _FORMATOS[formato], "datefmt": "%Y-%m-%d %H:%M:%S"},
            },
            "handlers": {
                "consola": {"class": "logging.StreamHandler", "formatter": "qamp"},
            },
            "root": {"level": nivel, "handlers": ["consola"]},
        }
    )
