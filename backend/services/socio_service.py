from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from models.reserva import CondicionPersonaEnum
from models.user import User
from schemas.reserva import hoy_argentina
from schemas.socio import SocioValidacion


def membresia_vigente(usuario: User, hoy: Optional[date] = None) -> bool:
    """
    Regla única de vigencia: es socio y su membresía vence hoy o después (fecha de Argentina).
    El día del vencimiento todavía es válido. estado_cuota no se usa.
    """
    if not usuario.is_socio or usuario.membresia_vence is None:
        return False
    return usuario.membresia_vence >= (hoy or hoy_argentina())


def validar_socio(db: Session, dni: str) -> SocioValidacion:
    """
    Valida un DNI contra la base. Es el servicio que usan GET /socios/validar/{dni}
    y las reservas (Issue 14).
    """
    usuario = db.query(User).filter(User.dni == dni.strip()).first()
    if usuario is None:
        return SocioValidacion(valido=False, motivo="NO_EXISTE")
    if not usuario.is_socio:
        return SocioValidacion(valido=False, motivo="NO_ES_SOCIO")
    if not membresia_vigente(usuario, hoy_argentina()):
        return SocioValidacion(valido=False, motivo="CUOTA_VENCIDA")
    return SocioValidacion(valido=True, nombre=usuario.nombre, condicion=CondicionPersonaEnum.socio)
