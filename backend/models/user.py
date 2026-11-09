import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, Boolean, Date, DateTime, Enum, true
from sqlalchemy.dialects.postgresql import UUID

# Importamos la clase Base que creaste en la Sub-issue 1.2
from core.database import Base

# 1. Definimos los roles exactos mediante un Enum
class RoleEnum(enum.Enum):
    ADMIN = "Admin"
    SEGURIDAD = "Seguridad"
    CLIENTE = "Cliente"

# 2. Creamos el modelo principal
class User(Base):
    __tablename__ = "usuarios"

    # Campos básicos
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    nombre = Column(String, nullable=False)
    dni = Column(String, unique=True, index=True, nullable=False)

    # Rol y membresía
    rol = Column(Enum(RoleEnum), default=RoleEnum.CLIENTE, nullable=False)
    is_socio = Column(Boolean, default=False)
    # Último día en que la cuota está al día. Es lo que decide si la membresía está vigente
    membresia_vence = Column(Date, nullable=True)
    # En desuso: se conserva por compatibilidad, pero ya no se usa para decidir nada
    estado_cuota = Column(String, nullable=True)
    # La baja no borra al usuario (sus reservas lo siguen referenciando): lo desactiva.
    # Un usuario inactivo no puede iniciar sesión ni valida como socio
    activo = Column(Boolean, default=True, server_default=true(), nullable=False)

    # Atributos de auditoría estándar
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)