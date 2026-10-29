from typing import List, Literal, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.user import RoleEnum, User
from schemas.socio import SocioCreate, SocioOut
from services.auth_service import hash_password
from services.socio_service import membresia_vigente

# Alta y listado de socios desde el panel. Va aparte de socio_service porque necesita
# auth_service (hash de contraseñas), que a su vez usa socio_service para la vigencia.


class SocioDuplicadoError(Exception):
    """Ya existe un usuario con ese DNI o ese email."""

    def __init__(self, campo: Literal["dni", "email"]):
        self.campo = campo
        super().__init__(f"Ya existe un usuario con ese {campo}.")


def _campo_duplicado(db: Session, dni: str, email: str) -> Optional[Literal["dni", "email"]]:
    if db.query(User).filter(User.dni == dni).first():
        return "dni"
    # El login no distingue mayúsculas en el email, así que acá tampoco
    if db.query(User).filter(func.lower(User.email) == email.lower()).first():
        return "email"
    return None


def socio_out(usuario: User) -> SocioOut:
    return SocioOut(
        id=usuario.id,
        nombre=usuario.nombre,
        dni=usuario.dni,
        email=usuario.email,
        membresia_vence=usuario.membresia_vence,
        membresia_vigente=membresia_vigente(usuario),
    )


def crear_socio(db: Session, datos: SocioCreate) -> User:
    """
    Da de alta un socio: rol CLIENTE, is_socio verdadero y contraseña guardada con hash.
    Lanza SocioDuplicadoError si el DNI o el email ya existen.
    """
    email = str(datos.email).lower()
    duplicado = _campo_duplicado(db, datos.dni, email)
    if duplicado:
        raise SocioDuplicadoError(duplicado)

    usuario = User(
        nombre=datos.nombre,
        dni=datos.dni,
        email=email,
        password_hash=hash_password(datos.password),
        rol=RoleEnum.CLIENTE,
        is_socio=True,
        membresia_vence=datos.membresia_vence,
    )
    db.add(usuario)
    try:
        db.commit()
    except IntegrityError:
        # Otro pedido creó el mismo DNI o email justo antes
        db.rollback()
        raise SocioDuplicadoError(_campo_duplicado(db, datos.dni, email) or "dni")
    db.refresh(usuario)
    return usuario


def listar_socios(db: Session) -> List[User]:
    return db.query(User).filter(User.is_socio.is_(True)).order_by(User.nombre, User.dni).all()
