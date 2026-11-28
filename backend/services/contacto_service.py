"""Formulario de Contacto (Issue 31.5): límite de envíos y mensajes al visitante.

El límite vive en la memoria del proceso: no hay tabla ni dependencia nueva. Sirve mientras el backend
corra en un solo proceso (hoy, un `uvicorn` en Render). Se reinicia con cada reinicio del servicio y no se
comparte entre procesos o instancias: con más de uno, cada uno contaría por su lado y el límite real
sería el de uno multiplicado por la cantidad de procesos.
"""
import threading
import time
from collections import deque
from typing import Callable, Deque, Dict

# Por visitante (IP): 5 mensajes cada 10 minutos
POR_IP_MAXIMO = 5
POR_IP_VENTANA_SEGUNDOS = 10 * 60
# En total, entre todos los visitantes: 30 mensajes por hora. Protege la casilla del camping y la cuota
# de Resend aunque alguien cambie de IP o la IP no se pueda identificar
GLOBAL_MAXIMO = 30
GLOBAL_VENTANA_SEGUNDOS = 60 * 60

# Cuántas IP se recuerdan como máximo antes de descartar las que ya no cuentan
_MAX_IP_RECORDADAS = 5000

MENSAJE_ENVIADO = "¡Mensaje enviado! Te vamos a responder por correo lo antes posible."
ERROR_ENVIO = "No pudimos enviar tu mensaje. Probá de nuevo en unos minutos o comunicate por teléfono."
ERROR_NO_CONFIGURADO = "El formulario de contacto no está disponible por el momento. Probá más tarde."


def mensaje_de_espera(segundos: int) -> str:
    minutos = max(1, -(-segundos // 60))
    unidad = "minuto" if minutos == 1 else "minutos"
    return f"Enviaste muchos mensajes en poco tiempo. Probá de nuevo en {minutos} {unidad}."


class LimiteDeEnvios:
    """Ventana deslizante: a lo sumo `maximo` envíos por IP en `ventana` segundos, y `maximo_global` en total."""

    def __init__(
        self,
        maximo: int = POR_IP_MAXIMO,
        ventana: int = POR_IP_VENTANA_SEGUNDOS,
        maximo_global: int = GLOBAL_MAXIMO,
        ventana_global: int = GLOBAL_VENTANA_SEGUNDOS,
        reloj: Callable[[], float] = time.monotonic,
    ):
        self._maximo, self._ventana = maximo, ventana
        self._maximo_global, self._ventana_global = maximo_global, ventana_global
        self._reloj = reloj
        self._por_ip: Dict[str, Deque[float]] = {}
        self._global: Deque[float] = deque()
        self._candado = threading.Lock()

    @staticmethod
    def _descartar_vencidos(envios: Deque[float], ahora: float, ventana: int) -> None:
        while envios and ahora - envios[0] >= ventana:
            envios.popleft()

    def _espera(self, envios: Deque[float], ahora: float, ventana: int, maximo: int) -> int:
        """Segundos hasta que se libere un lugar; 0 si todavía hay."""
        if len(envios) < maximo:
            return 0
        return max(1, int(ventana - (ahora - envios[0])) + 1)

    def intentar(self, ip: str) -> int:
        """Anota un envío. Devuelve 0 si se puede, o los segundos que faltan para poder enviar otro."""
        with self._candado:
            ahora = self._reloj()
            propios = self._por_ip.setdefault(ip, deque())
            self._descartar_vencidos(propios, ahora, self._ventana)
            self._descartar_vencidos(self._global, ahora, self._ventana_global)

            espera = max(
                self._espera(propios, ahora, self._ventana, self._maximo),
                self._espera(self._global, ahora, self._ventana_global, self._maximo_global),
            )
            if espera:
                return espera

            propios.append(ahora)
            self._global.append(ahora)
            if len(self._por_ip) > _MAX_IP_RECORDADAS:
                self._olvidar_vencidas(ahora)
            return 0

    def _olvidar_vencidas(self, ahora: float) -> None:
        for clave in list(self._por_ip):
            envios = self._por_ip[clave]
            self._descartar_vencidos(envios, ahora, self._ventana)
            if not envios:
                del self._por_ip[clave]

    def reiniciar(self) -> None:
        with self._candado:
            self._por_ip.clear()
            self._global.clear()


limite_de_envios = LimiteDeEnvios()
