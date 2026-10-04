from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.user import RoleEnum, User

# Identidad fija (por email, NO por UUID) del usuario de prueba.
# El UUID lo genera la base de cada entorno, por eso nunca se hardcodea.
EMAIL_USUARIO_PRUEBA = "cliente.prueba@camping.com"
DNI_USUARIO_PRUEBA = "PRUEBA-0001"
NOMBRE_USUARIO_PRUEBA = "Cliente de Prueba"

# Valor que no es un hash válido: nadie puede iniciar sesión con este usuario.
PASSWORD_HASH_NO_UTILIZABLE = "!"


def obtener_o_crear_usuario_prueba(db: Session) -> User:
    """
    Devuelve el usuario de prueba, creándolo si todavía no existe.

    - Es idempotente: llamarla muchas veces siempre devuelve el mismo usuario.
    - No borra ni modifica ningún dato existente.
    - Tolera llamadas concurrentes (si dos requests lo crean a la vez, gana una
      y la otra reutiliza el usuario ya creado).
    """
    usuario = db.query(User).filter(User.email == EMAIL_USUARIO_PRUEBA).first()
    if usuario:
        return usuario

    usuario = User(
        email=EMAIL_USUARIO_PRUEBA,
        password_hash=PASSWORD_HASH_NO_UTILIZABLE,
        nombre=NOMBRE_USUARIO_PRUEBA,
        dni=DNI_USUARIO_PRUEBA,
        rol=RoleEnum.CLIENTE,
        is_socio=False,
    )
    db.add(usuario)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        usuario = db.query(User).filter(User.email == EMAIL_USUARIO_PRUEBA).first()
        if usuario is None:
            raise
        return usuario

    db.refresh(usuario)
    return usuario
