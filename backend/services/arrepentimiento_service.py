"""Botón de arrepentimiento sin cuenta (Issue 25.2).

Quien reservó pide los enlaces con su email y le llega un correo con un enlace por reserva. Cada
enlace lleva un token firmado con el id de una sola reserva, el email y el propósito, y vence a los
ARREPENTIMIENTO_TOKEN_MINUTOS. Así nadie cancela la reserva de otro sabiendo solo su email.
La cancelación en sí es la de cancelacion_service (25.1), con su bloqueo y sus reglas.
"""
from datetime import timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

import jwt
from fastapi import BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import settings
from core.tiempo import ahora_utc
from models.reserva import EstadoPagoEnum, EstadoReservaEnum, Reserva
from schemas.reserva import hoy_argentina
from services.cancelacion_service import formatear_pesos
from services.email_service import email_service

ALGORITMO = "HS256"
PROPOSITO = "arrepentimiento"

MENSAJE_SOLICITUD = "Si hay reservas con ese email, te enviamos un correo con un enlace para cada una."
MOTIVO_ARREPENTIMIENTO = "Cancelaste la reserva desde el botón de arrepentimiento."
ENLACE_VENCIDO = "El enlace venció. Pedí uno nuevo desde el botón de arrepentimiento."
ENLACE_INVALIDO = "El enlace no es válido. Pedí uno nuevo desde el botón de arrepentimiento."


class EnlaceVencidoError(Exception):
    pass


class EnlaceInvalidoError(Exception):
    """Firma alterada, otro propósito, o una reserva que no existe o no es de ese email."""


def _normalizar(email: str) -> str:
    return email.strip().lower()


def crear_token(reserva: Reserva, minutos: Optional[int] = None) -> str:
    ahora = ahora_utc()
    payload = {
        "sub": str(reserva.id),
        "email": _normalizar(reserva.email),
        "purpose": PROPOSITO,
        "iat": ahora,
        "exp": ahora + timedelta(minutes=settings.ARREPENTIMIENTO_TOKEN_MINUTOS if minutos is None else minutos),
    }
    return jwt.encode(payload, settings.ARREPENTIMIENTO_SECRET_KEY, algorithm=ALGORITMO)


def reserva_del_token(db: Session, token: str) -> Reserva:
    """La reserva que nombra el enlace. Lanza EnlaceVencidoError o EnlaceInvalidoError."""
    try:
        datos = jwt.decode(
            token,
            settings.ARREPENTIMIENTO_SECRET_KEY,
            algorithms=[ALGORITMO],
            options={"require": ["exp", "sub", "email", "purpose"]},
        )
    except jwt.ExpiredSignatureError:
        raise EnlaceVencidoError()
    except jwt.InvalidTokenError:
        raise EnlaceInvalidoError()
    if datos["purpose"] != PROPOSITO:
        raise EnlaceInvalidoError()
    try:
        reserva_id = UUID(str(datos["sub"]))
    except ValueError:
        raise EnlaceInvalidoError()
    reserva = db.get(Reserva, reserva_id)
    if reserva is None or _normalizar(reserva.email) != datos["email"]:
        raise EnlaceInvalidoError()
    return reserva


def reservas_del_email(db: Session, email: str) -> list[Reserva]:
    """Reservas pagadas y próximas del email (con ingreso de hoy en adelante)."""
    return (
        db.query(Reserva)
        .filter(
            func.lower(Reserva.email) == _normalizar(email),
            Reserva.estado_pago == EstadoPagoEnum.PAGADO,
            Reserva.estado_reserva == EstadoReservaEnum.CONFIRMADA,
            Reserva.fecha_ingreso >= hoy_argentina(),
        )
        .order_by(Reserva.fecha_ingreso)
        .all()
    )


def solicitar_enlaces(db: Session, email: str, background_tasks: BackgroundTasks) -> None:
    """Manda un correo con un enlace por reserva. Si no hay reservas no manda nada: quien llama
    responde siempre lo mismo, para no revelar si el email tiene reservas."""
    reservas = reservas_del_email(db, email)
    if not reservas:
        return
    web = settings.FRONTEND_URL.rstrip("/")
    detalle = [
        {
            "reserva_id": str(r.id),
            "fecha_ingreso": r.fecha_ingreso.strftime("%d/%m/%Y"),
            "fecha_egreso": r.fecha_egreso.strftime("%d/%m/%Y"),
            "cantidad_personas": r.cantidad_personas,
            "monto": formatear_pesos(Decimal(str(r.monto_total))),
            "enlace": f"{web}/cancelar-reserva?token={crear_token(r)}",
        }
        for r in reservas
    ]
    background_tasks.add_task(
        email_service.enviar_enlaces_arrepentimiento_sync,
        destinatario=reservas[0].email,
        datos={"reservas": detalle, "minutos": settings.ARREPENTIMIENTO_TOKEN_MINUTOS},
    )
