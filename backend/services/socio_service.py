from datetime import date
from typing import Iterable, Optional, Protocol

from sqlalchemy.orm import Session

from models.reserva import CondicionPersonaEnum
from models.user import User
from schemas.reserva import hoy_argentina
from schemas.socio import MotivoSocio, SocioValidacion


def membresia_vigente(usuario: User, hoy: Optional[date] = None) -> bool:
    """
    Regla única de vigencia: es socio, no está dado de baja y su membresía vence hoy
    o después (fecha de Argentina). El día del vencimiento todavía es válido. estado_cuota no se usa.
    """
    if not usuario.activo or not usuario.is_socio or usuario.membresia_vence is None:
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
    # Un socio dado de baja se informa igual que alguien que no es socio:
    # el endpoint es público y no hace falta contar por qué dejó de serlo
    if not usuario.is_socio or not usuario.activo:
        return SocioValidacion(valido=False, motivo="NO_ES_SOCIO")
    if not membresia_vigente(usuario, hoy_argentina()):
        return SocioValidacion(valido=False, motivo="CUOTA_VENCIDA")
    return SocioValidacion(valido=True, nombre=usuario.nombre, condicion=CondicionPersonaEnum.socio)


class PersonaConCondicion(Protocol):
    condicion: CondicionPersonaEnum
    dni: Optional[str]


class SocioNoValidoError(Exception):
    """Una persona de la reserva figura como socio, pero su DNI no valida como tal."""

    def __init__(self, dni: str, motivo: MotivoSocio):
        self.dni = dni
        self.motivo = motivo
        if motivo == "CUOTA_VENCIDA":
            mensaje = f"El socio con DNI {dni} tiene la membresía vencida."
        else:
            mensaje = f"El DNI {dni} no corresponde a un socio."
        super().__init__(mensaje)


def verificar_personas_socias(db: Session, personas: Iterable[PersonaConCondicion]) -> None:
    """
    El descuento de socio no se confía al formulario: cada persona marcada como socio
    se valida con la misma regla que GET /socios/validar/{dni}, así respeta el vencimiento y la baja.
    Lanza SocioNoValidoError con la primera que no valide.
    """
    for persona in personas:
        if persona.condicion != CondicionPersonaEnum.socio:
            continue
        # El schema de la reserva ya exige el DNI a los socios
        dni = persona.dni or ""
        resultado = validar_socio(db, dni)
        if not resultado.valido:
            raise SocioNoValidoError(dni, resultado.motivo or "NO_EXISTE")
