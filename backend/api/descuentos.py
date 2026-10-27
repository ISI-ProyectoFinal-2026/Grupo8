from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import require_role
from models.descuento import Descuento
from models.user import RoleEnum
from schemas.descuento import (
    DescuentoCreate,
    DescuentoOut,
    DescuentoUpdate,
    validar_coherencia_edades,
)

# Todo el router es solo para el administrador
router = APIRouter(
    prefix="/admin/descuentos",
    tags=["Descuentos"],
    dependencies=[Depends(require_role(RoleEnum.ADMIN))],
)


@router.get("", response_model=List[DescuentoOut])
def listar_descuentos(db: Session = Depends(get_db)):
    return db.query(Descuento).order_by(Descuento.nombre, Descuento.codigo).all()


@router.post("", response_model=DescuentoOut, status_code=status.HTTP_201_CREATED)
def crear_descuento(descuento_in: DescuentoCreate, db: Session = Depends(get_db)):
    if db.query(Descuento).filter(Descuento.codigo == descuento_in.codigo).first():
        raise HTTPException(status_code=409, detail="Ya existe un descuento con ese código.")

    descuento = Descuento(**descuento_in.model_dump())
    try:
        db.add(descuento)
        db.commit()
        db.refresh(descuento)
    except IntegrityError:
        # Otro pedido creó el mismo código justo antes
        db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe un descuento con ese código.")
    return descuento


@router.put("/{descuento_id}", response_model=DescuentoOut)
def modificar_descuento(
    descuento_id: UUID, cambios: DescuentoUpdate, db: Session = Depends(get_db)
):
    descuento = db.query(Descuento).filter(Descuento.id == descuento_id).first()
    if not descuento:
        raise HTTPException(status_code=404, detail="Descuento no encontrado.")

    # Solo se aplican los campos que llegaron en el pedido
    for campo in cambios.model_fields_set:
        setattr(descuento, campo, getattr(cambios, campo))

    # Los límites de edad tienen que quedar coherentes con el tipo de descuento
    try:
        validar_coherencia_edades(descuento.aplica_a, descuento.edad_min, descuento.edad_max)
    except ValueError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error))

    db.commit()
    db.refresh(descuento)
    return descuento
