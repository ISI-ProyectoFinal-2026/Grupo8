from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.database import get_db
from schemas.socio import SocioValidacion
from services.socio_service import validar_socio

router = APIRouter(prefix="/socios", tags=["Socios"])


@router.get("/validar/{dni}", response_model=SocioValidacion)
def validar_dni_socio(dni: str, db: Session = Depends(get_db)):
    """
    Dice si un DNI corresponde a un socio con la cuota al día. Es público: lo usa el formulario
    de reserva antes de que la persona inicie sesión. Solo informa nombre y condición si es válido.
    """
    return validar_socio(db, dni)
