from typing import List, Literal, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.user import RoleEnum, User
from schemas.reserva import hoy_argentina
from schemas.socio import EstadoMembresia, SocioCreate, SocioOut, SocioRenovacion, SocioUpdate
from services.auth_service import hash_password
from services.socio_service import membresia_vigente

# Gestión de socios desde el panel: alta, listado, edición, renovación, baja y reactivación.
# Va aparte de socio_service porque necesita auth_service (hash de contraseñas),
# que a su vez usa socio_service para la vigencia.


class SocioDuplicadoError(Exception):
    """Ya existe un usuario con ese DNI o ese email."""

    def __init__(self, campo: Literal["dni", "email"]):
        self.campo = campo
        super().__init__(f"Ya existe un usuario con ese {campo}.")


class SocioNoEncontradoError(Exception):
    """No hay un socio con ese id (o el usuario existe pero no es socio)."""


class EstadoSocioError(Exception):
    """La operación no corresponde al estado actual del socio (por ejemplo, renovar a un dado de baja)."""


def _campo_duplicado(
    db: Session, dni: str, email: str, excluir_id: Optional[UUID] = None
) -> Optional[Literal["dni", "email"]]:
    """Qué campo ya usa otro usuario. Al editar se excluye al propio socio."""
    otros = db.query(User)
    if excluir_id is not None:
        otros = otros.filter(User.id != excluir_id)
    if otros.filter(User.dni == dni).first():
        return "dni"
    # El login no distingue mayúsculas en el email, así que acá tampoco
    if otros.filter(func.lower(User.email) == email.lower()).first():
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
        activo=usuario.activo,
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


# Letras con acento y su versión sin acento, para buscar nombres sin importar cómo se escribieron.
# Se usa igual en Python (el texto buscado) y en SQL (translate sobre la columna), así no hace
# falta la extensión unaccent. Van las mayúsculas también: con algunas configuraciones de
# PostgreSQL, lower() no convierte las mayúsculas acentuadas.
CON_ACENTO = "ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç"
SIN_ACENTO = "AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc"
_TABLA_ACENTOS = str.maketrans(CON_ACENTO, SIN_ACENTO)


def normalizar(texto: str) -> str:
    """Minúsculas y sin acentos: "Núñez" → "nunez"."""
    return texto.translate(_TABLA_ACENTOS).lower()


def _nombre_normalizado() -> ColumnElement[str]:
    return func.lower(func.translate(User.nombre, CON_ACENTO, SIN_ACENTO))


def _condicion_busqueda(buscar: str) -> Optional[ColumnElement[bool]]:
    """
    Si el texto son solo números (se aceptan puntos, como en "30.111.222") se busca por DNI:
    los que empiezan con esos dígitos. Si no, por nombre: cada palabra tiene que aparecer
    en el nombre, sin importar el orden, las mayúsculas ni los acentos.
    """
    texto = buscar.strip()
    digitos = texto.replace(".", "")
    if digitos.isdigit():
        return User.dni.startswith(digitos, autoescape=True)
    palabras = normalizar(texto).split()
    if not palabras:
        return None
    nombre = _nombre_normalizado()
    return and_(*(nombre.contains(palabra, autoescape=True) for palabra in palabras))


def _condicion_estado(estado: EstadoMembresia) -> ColumnElement[bool]:
    """Misma regla que membresia_vigente, escrita como consulta."""
    if estado == "baja":
        return User.activo.is_(False)
    hoy = hoy_argentina()
    if estado == "vigente":
        return and_(User.activo.is_(True), User.membresia_vence >= hoy)
    # Vencida: sigue activo, pero sin fecha o con la fecha ya pasada
    return and_(User.activo.is_(True), or_(User.membresia_vence.is_(None), User.membresia_vence < hoy))


def listar_socios(
    db: Session, buscar: Optional[str] = None, estado: Optional[EstadoMembresia] = None
) -> List[User]:
    """Padrón de socios, ordenado por nombre. La búsqueda y el filtro se pueden combinar."""
    consulta = db.query(User).filter(User.is_socio.is_(True))
    if buscar:
        condicion = _condicion_busqueda(buscar)
        if condicion is not None:
            consulta = consulta.filter(condicion)
    if estado:
        consulta = consulta.filter(_condicion_estado(estado))
    return consulta.order_by(User.nombre, User.dni).all()


def obtener_socio(db: Session, socio_id: UUID) -> User:
    """
    Busca un socio por id. Los usuarios que no son socios (administradores, guardias, clientes)
    no se gestionan desde acá, así que para estas operaciones es como si no existieran.
    """
    usuario = db.query(User).filter(User.id == socio_id, User.is_socio.is_(True)).first()
    if usuario is None:
        raise SocioNoEncontradoError()
    return usuario


def editar_socio(db: Session, socio_id: UUID, cambios: SocioUpdate) -> User:
    """
    Corrige nombre, DNI o email. Solo cambia los campos enviados.
    Lanza SocioDuplicadoError si el DNI o el email nuevos ya los usa otro usuario.
    """
    usuario = obtener_socio(db, socio_id)
    enviados = cambios.model_fields_set
    dni = cambios.dni if "dni" in enviados and cambios.dni else usuario.dni
    email = str(cambios.email).lower() if "email" in enviados and cambios.email else usuario.email

    duplicado = _campo_duplicado(db, dni, email, excluir_id=usuario.id)
    if duplicado:
        raise SocioDuplicadoError(duplicado)

    if "nombre" in enviados:
        usuario.nombre = cambios.nombre
    usuario.dni = dni
    usuario.email = email
    try:
        db.commit()
    except IntegrityError:
        # Otro pedido tomó el mismo DNI o email justo antes
        db.rollback()
        raise SocioDuplicadoError(_campo_duplicado(db, dni, email, excluir_id=socio_id) or "dni")
    db.refresh(usuario)
    return usuario


def renovar_membresia(db: Session, socio_id: UUID, renovacion: SocioRenovacion) -> User:
    """
    Carga la nueva fecha de vencimiento. Un socio dado de baja no se renueva:
    primero hay que reactivarlo.
    """
    usuario = obtener_socio(db, socio_id)
    if not usuario.activo:
        raise EstadoSocioError("El socio está dado de baja. Reactivalo antes de renovar la membresía.")
    usuario.membresia_vence = renovacion.membresia_vence
    db.commit()
    db.refresh(usuario)
    return usuario


def dar_de_baja(db: Session, socio_id: UUID) -> User:
    """
    Baja sin borrar el registro: las reservas lo siguen referenciando.
    Desde ese momento no valida como socio, no puede iniciar sesión y su sesión abierta deja de valer.
    """
    usuario = obtener_socio(db, socio_id)
    if not usuario.activo:
        raise EstadoSocioError("El socio ya está dado de baja.")
    usuario.activo = False
    db.commit()
    db.refresh(usuario)
    return usuario


def reactivar_socio(db: Session, socio_id: UUID) -> User:
    """
    Vuelve a activar a un socio dado de baja. No toca la fecha de vencimiento:
    si la membresía venció mientras estuvo de baja, se renueva aparte.
    """
    usuario = obtener_socio(db, socio_id)
    if usuario.activo:
        raise EstadoSocioError("El socio ya está activo.")
    usuario.activo = True
    db.commit()
    db.refresh(usuario)
    return usuario
