# Importaciones nuevas para la seguridad
from models.user import User, RoleEnum
from core.dependencies import get_current_user, require_role

from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from core.config import settings
from core.database import get_db 
from schemas.reserva import ReservaCreate, ReservaResponse
from models.reserva import Reserva, EstadoPagoEnum, EstadoReservaEnum
from models.configuracion import ConfiguracionCamping
from services.capacity_service import CapacityService
from services.pricing_service import PricingService

router = APIRouter(prefix="/reservas", tags=["Reservas"])
capacity_service = CapacityService()

@router.post("/", response_model=ReservaResponse, status_code=status.HTTP_201_CREATED)
def crear_reserva(reserva_in: ReservaCreate, db: Session = Depends(get_db)):

    # 1. Necesitamos al usuario real (para saber si es socio y calcular el precio)
    usuario = db.query(User).filter(User.id == reserva_in.user_id).first()
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    # 2. El camping tiene que estar configurado, porque la reserva lo referencia
    camping = db.query(ConfiguracionCamping).filter(
        ConfiguracionCamping.camping_id == settings.CAMPING_ID
    ).first()
    if not camping:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El camping no está configurado."
        )

    # 3. Calcular cuántos lugares están ocupados actualmente
    # Sumamos las personas de todas las reservas que NO estén canceladas
    lugares_ocupados = db.query(func.sum(Reserva.cantidad_personas)).filter(
        Reserva.estado_reserva != EstadoReservaEnum.CANCELADA
    ).scalar() or 0

    # 4. Validar disponibilidad (Endpoint POST)
    # Tu servicio lanzará automáticamente el Error 400 si se superó el límite
    capacity_service.check_availability(
        espacios_solicitados=reserva_in.cantidad_personas,
        reservas_activas=lugares_ocupados
    )

    # 5. Preparar el objeto para la base de datos
    # El monto lo calcula el backend, no lo manda el cliente
    nueva_reserva = Reserva(
        user_id=reserva_in.user_id,
        camping_id=camping.camping_id,
        fecha_ingreso=reserva_in.fecha_ingreso,
        fecha_egreso=reserva_in.fecha_egreso,
        cantidad_personas=reserva_in.cantidad_personas,
        monto_total=PricingService.calcular_precio(reserva_in.cantidad_personas, bool(usuario.is_socio)),
        titular=reserva_in.titular,
        email=reserva_in.email,
        telefono=reserva_in.telefono,
        estado_reserva=EstadoReservaEnum.PENDIENTE,
        estado_pago=EstadoPagoEnum.PENDIENTE
    )

    # 6. Transacción Atómica
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
    fecha_desde: Optional[date] = Query(None, description="Filtrar por reservas con ingreso a partir de esta fecha"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(RoleEnum.ADMIN)) #candado administrativo
):
    # Iniciamos la consulta base
    query = db.query(Reserva)

    # Aplicamos FILTROS dinámicamente si el usuario los mandó
    if estado:
        query = query.filter(Reserva.estado_pago == estado)
    if fecha_desde:
        query = query.filter(Reserva.fecha_ingreso >= fecha_desde)

    # Aplicamos la PAGINACIÓN y ejecutamos la consulta
    reservas = query.offset(skip).limit(limit).all()

    return reservas