from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.database import get_db 
from schemas.reserva import ReservaCreate, ReservaResponse
from models.reserva import Reserva, EstadoPagoEnum
from services.capacity_service import CapacityService

router = APIRouter(prefix="/reservas", tags=["Reservas"])
capacity_service = CapacityService()

@router.post("/", response_model=ReservaResponse, status_code=status.HTTP_201_CREATED)
def crear_reserva(reserva_in: ReservaCreate, db: Session = Depends(get_db)):

    # 1. Calcular cuántos lugares están ocupados actualmente
    # Sumamos las personas de todas las reservas que NO estén canceladas
    lugares_ocupados = db.query(func.sum(Reserva.cantidad_personas)).filter(
        Reserva.estado_pago != EstadoPagoEnum.CANCELADO
    ).scalar() or 0

    # 2. Validar disponibilidad (Endpoint POST)
    # Tu servicio lanzará automáticamente el Error 400 si se superó el límite
    capacity_service.check_availability(
        espacios_solicitados=reserva_in.cantidad_personas,
        reservas_activas=lugares_ocupados
    )

    # 3. Preparar el objeto para la base de datos
    nueva_reserva = Reserva(
        user_id=reserva_in.user_id,
        fecha_reserva=reserva_in.fecha_reserva,
        cantidad_personas=reserva_in.cantidad_personas,
        estado_pago=EstadoPagoEnum.PENDIENTE
    )

    # 4. Transacción Atómica
    try:
        db.add(nueva_reserva)
        db.commit()               # Se ejecuta la transacción
        db.refresh(nueva_reserva) # Traemos los datos frescos (como el ID autogenerado)
        return nueva_reserva
    except Exception as e:
        db.rollback()             # Si algo falla arriba, se revierte todo de forma segura
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al procesar la reserva. Intente nuevamente."
        )

@router.get("/", response_model=List[ReservaResponse])
def obtener_reservas(
    skip: int = Query(0, ge=0, description="Cantidad de registros a omitir (Paginación)"),
    limit: int = Query(10, le=100, description="Límite de registros a devolver (Paginación)"),
    estado: Optional[EstadoPagoEnum] = Query(None, description="Filtrar por estado de pago"),
    fecha_desde: Optional[datetime] = Query(None, description="Filtrar por reservas a partir de esta fecha"),
    db: Session = Depends(get_db)
):
    # Iniciamos la consulta base
    query = db.query(Reserva)

    # Aplicamos FILTROS dinámicamente si el usuario los mandó
    if estado:
        query = query.filter(Reserva.estado_pago == estado)
    if fecha_desde:
        query = query.filter(Reserva.fecha_reserva >= fecha_desde)

    # Aplicamos la PAGINACIÓN y ejecutamos la consulta
    reservas = query.offset(skip).limit(limit).all()

    return reservas