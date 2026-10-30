"""Fechas y zonas horarias del backend.

Regla del proyecto:
- Todo instante se guarda en UTC, en columnas con zona horaria (timestamptz).
- Lo que llega de afuera (la PWA manda ISO 8601, ej. 2026-10-25T14:30:00.000Z) se
  normaliza a UTC al validarlo, antes de llegar a SQLAlchemy.
- America/Argentina/Buenos_Aires es la zona del negocio: se usa para mostrar una hora
  y para decidir a qué día pertenece un instante, nunca para guardarlo.
"""
from datetime import datetime, timezone
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