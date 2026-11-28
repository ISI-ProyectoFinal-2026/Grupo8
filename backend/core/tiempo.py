"""Fechas y zonas horarias del backend.

Regla del proyecto:
- Todo instante se guarda en UTC, en columnas con zona horaria (timestamptz).
- Lo que llega de afuera (la PWA manda ISO 8601, ej. 2026-10-25T14:30:00.000Z) se
  normaliza a UTC al validarlo, antes de llegar a SQLAlchemy.
- America/Argentina/Buenos_Aires es la zona del negocio: se usa para mostrar una hora
  y para decidir a qué día pertenece un instante, nunca para guardarlo.
"""
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ZONA_NEGOCIO = ZoneInfo("America/Argentina/Buenos_Aires")


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


def a_utc(valor: datetime) -> datetime:
    """Pasa una fecha con zona a UTC. Una fecha sin zona se rechaza: asumirle una sería adivinar."""
    if valor.utcoffset() is None:
        raise ValueError("La fecha debe incluir zona horaria (ej: 2026-10-25T14:30:00Z).")
    return valor.astimezone(timezone.utc)


def a_zona_negocio(valor: datetime) -> datetime:
    """Pasa un instante a la hora de Buenos Aires, para mostrarlo o saber en qué día cae.
    Una fecha sin zona viene de una columna antigua y se toma como UTC."""
    if valor.utcoffset() is None:
        valor = valor.replace(tzinfo=timezone.utc)
    return valor.astimezone(ZONA_NEGOCIO)

def dia_negocio(instante: datetime) -> date:
    """El día de Buenos Aires al que pertenece un instante.
    Ej: 2026-11-27 01:30 UTC es el 26 a las 22:30 en Argentina, así que devuelve el 26.
    Es lo que hay que comparar con las fechas de una reserva; la fecha UTC no sirve desde las 21:00."""
    return a_zona_negocio(instante).date()


def hoy_negocio() -> date:
    """El día de hoy en Buenos Aires (en UTC ya puede ser mañana desde las 21:00)."""
    return ahora_utc().astimezone(ZONA_NEGOCIO).date()


def limites_dias_negocio(desde: date, hasta: date) -> tuple[datetime, datetime]:
    """
    Instantes que encierran los días de Buenos Aires de `desde` a `hasta`, ambos incluidos:
    desde las 00:00 de `desde` hasta las 00:00 del día siguiente a `hasta` (ese instante ya no entra).

    Se devuelven con zona. Al compararlos con una columna timestamptz, PostgreSQL los pasa a UTC,
    así que el corte cae justo en la medianoche argentina (03:00 UTC) y no en la de UTC.
    El fin abierto evita perder lo que pasó en el último segundo del día (23:59:59.5).
    """
    inicio = datetime.combine(desde, time.min, tzinfo=ZONA_NEGOCIO)
    fin = datetime.combine(hasta + timedelta(days=1), time.min, tzinfo=ZONA_NEGOCIO)
    return inicio, fin
