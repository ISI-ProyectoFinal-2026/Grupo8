from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.tipo_reserva import TipoReserva
from models.user import RoleEnum
from schemas.tipo_reserva import (
    TipoReservaCreate,
    TipoReservaOut,
    TipoReservaPublico,
    TipoReservaUpdate,
    validar_unidades_segun_forma_cobro,
)
from services.camping_service import obtener_o_crear_camping

NOMBRE_REPETIDO = "Ya existe un tipo de reserva con ese nombre."

# Público: la web de reservas muestra solo los tipos activos
router = APIRouter(prefix="/api/v1/tipos-reserva", tags=["Tipos de reserva"])

# ABM solo para el administrador. No hay borrado: un tipo se desactiva
admin_router = APIRouter(
    prefix="/api/v1/admin/tipos-reserva",
    tags=["Tipos de reserva"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


def _nombre_en_uso(db: Session, nombre: str, excepto_id: Optional[UUID] = None) -> bool:
    """Compara sin distinguir mayúsculas, igual que el índice único de la base."""
    consulta = db.query(TipoReserva).filter(func.lower(TipoReserva.nombre) == nombre.lower())
    if excepto_id is not None:
        consulta = consulta.filter(TipoReserva.id != excepto_id)
    return db.query(consulta.exists()).scalar()


def _validar_max_personas(db: Session, max_personas: int) -> None:
    """Un tipo no puede permitir más personas que el máximo general por reserva (Issue 19.1)."""
    maximo = obtener_o_crear_camping(db).max_personas_por_reserva
    if max_personas > maximo:
        raise HTTPException(
            status_code=422,
            detail=f"El máximo de personas no puede superar el máximo general por reserva ({maximo}).",
        )


@router.get("", response_model=List[TipoReservaPublico])
def listar_tipos_activos(db: Session = Depends(get_db)):
    return (
        db.query(TipoReserva)
        .filter(TipoReserva.activo.is_(True))
        .order_by(TipoReserva.precio, TipoReserva.nombre)
        .all()
    )


@admin_router.get("", response_model=List[TipoReservaOut])
def listar_tipos(db: Session = Depends(get_db)):
    # Todos, también los desactivados, para poder volver a activarlos
    return db.query(TipoReserva).order_by(TipoReserva.precio, TipoReserva.nombre).all()


@admin_router.post("", response_model=TipoReservaOut, status_code=status.HTTP_201_CREATED)
def crear_tipo(tipo_in: TipoReservaCreate, db: Session = Depends(get_db)):
    _validar_max_personas(db, tipo_in.max_personas)
    if _nombre_en_uso(db, tipo_in.nombre):
        raise HTTPException(status_code=409, detail=NOMBRE_REPETIDO)

    tipo = TipoReserva(**tipo_in.model_dump())
    try:
        db.add(tipo)
        db.commit()
        db.refresh(tipo)
    except IntegrityError:
        # Otro pedido creó el mismo nombre justo antes
        db.rollback()
        raise HTTPException(status_code=409, detail=NOMBRE_REPETIDO)
    return tipo


@admin_router.put("/{tipo_id}", response_model=TipoReservaOut)
def modificar_tipo(tipo_id: UUID, cambios: TipoReservaUpdate, db: Session = Depends(get_db)):
    tipo = db.query(TipoReserva).filter(TipoReserva.id == tipo_id).first()
    if not tipo:
        raise HTTPException(status_code=404, detail="Tipo de reserva no encontrado.")

    enviados = cambios.model_fields_set
    if "max_personas" in enviados:
        _validar_max_personas(db, cambios.max_personas)
    if "nombre" in enviados and _nombre_en_uso(db, cambios.nombre, excepto_id=tipo.id):
        raise HTTPException(status_code=409, detail=NOMBRE_REPETIDO)

    # Solo se aplican los campos que llegaron. Desactivar no toca las reservas que ya usan el tipo
    for campo in enviados:
        setattr(tipo, campo, getattr(cambios, campo))

    # La forma de cobro y las unidades tienen que quedar coherentes entre sí
    try:
        validar_unidades_segun_forma_cobro(tipo.forma_cobro, tipo.cantidad_unidades)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error))

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=NOMBRE_REPETIDO)
    db.refresh(tipo)
    return tipo
