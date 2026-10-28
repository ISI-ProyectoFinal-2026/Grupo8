# Importaciones nuevas para la seguridad
from models.user import User, RoleEnum
from core.dependencies import get_current_user, get_current_user_optional, require_role

from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, and_

from core.config import settings
from core.database import get_db 
from schemas.cotizacion import CotizarDetalle, CotizarRequest, CotizarResponse
from schemas.reserva import ReservaCreate, ReservaDetalle, ReservaResponse
from models.reserva import (
    Reserva, ReservaPersona, EstadoPagoEnum, EstadoReservaEnum,
)
from models.configuracion import ConfiguracionCamping
from services.capacity_service import CapacityService
from services.pricing_service import Cotizacion, PersonaPrecio, PricingService

router = APIRouter(prefix="/reservas", tags=["Reservas"])
capacity_service = CapacityService()


def _respuesta_cotizacion(cotizacion: Cotizacion, personas: List[PersonaPrecio]) -> CotizarResponse:
    return CotizarResponse(
        subtotal=float(cotizacion.subtotal),
        descuento_total=float(cotizacion.descuento_total),
        total=float(cotizacion.total),
        cantidad_socios=cotizacion.cantidad_socios,
        detalle=[
            CotizarDetalle(
                indice=indice,
                condicion_efectiva=persona.condicion,
                descuento_codigo=precio.descuento_codigo,
                descuento_pct=float(precio.descuento_pct),
                precio_base=float(precio.precio_base),
                precio_final=float(precio.precio_final),
            )
            for indice, (persona, precio) in enumerate(zip(personas, cotizacion.personas))
        ],
    )


@router.post("/cotizar", response_model=CotizarResponse)
def cotizar_reserva(cotizacion_in: CotizarRequest, db: Session = Depends(get_db)):
    """Precio de una reserva sin guardarla. Es público: no pide sesión."""
    personas = [PersonaPrecio(p.edad, p.condicion) for p in cotizacion_in.personas]
    return _respuesta_cotizacion(PricingService.cotizar(db, personas), personas)


@router.post("/", response_model=ReservaResponse, status_code=status.HTTP_201_CREATED)
def crear_reserva(
    reserva_in: ReservaCreate,
    db: Session = Depends(get_db),
    usuario: Optional[User] = Depends(get_current_user_optional),
):

    # 1. Se puede reservar con o sin sesión. Con sesión la reserva queda a nombre del usuario del token
    # (ya validado por el backend); sin sesión, user_id queda en None
    user_id = usuario.id if usuario else None

    # 2. El camping tiene que estar configurado, porque la reserva lo referencia
    camping = db.query(ConfiguracionCamping).filter(
        ConfiguracionCamping.camping_id == settings.CAMPING_ID
    ).first()
    if not camping:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El camping no está configurado."
        )

    # 3. Calcular cuántos lugares están ocupados en las fechas solicitadas
    # Un solapamiento de fechas ocurre cuando el ingreso existente es <= al egreso solicitado, 
    # y el egreso existente es >= al ingreso solicitado.
    # Las reservas PENDIENTES y confirmadas consumen capacidad (!= CANCELADA) para evitar sobreventa.
    lugares_ocupados = db.query(func.sum(Reserva.cantidad_personas)).filter(
        and_(
            Reserva.estado_reserva != EstadoReservaEnum.CANCELADA,
            Reserva.fecha_ingreso <= reserva_in.fecha_egreso,
            Reserva.fecha_egreso >= reserva_in.fecha_ingreso
        )
    ).scalar() or 0

    # 4. Validar disponibilidad (Endpoint POST)
    # Tu servicio lanzará automáticamente el Error 400 si se superó el límite
    cantidad_personas = len(reserva_in.personas)
    capacity_service.check_availability(
        espacios_solicitados=cantidad_personas,
        reservas_activas=lugares_ocupados
    )

    # 5. Precio de cada persona y total, con la misma cuenta que usa la cotización
    # El monto lo calcula el backend, no lo manda el cliente
    cotizacion = PricingService.cotizar(
        db, [PersonaPrecio(p.edad, p.condicion) for p in reserva_in.personas]
    )
    personas = [
        ReservaPersona(
            orden=orden,
            nombre=persona_in.nombre,
            edad=persona_in.edad,
            condicion=persona_in.condicion,
            dni=persona_in.dni,
            precio_base=precio.precio_base,
            descuento_pct=precio.descuento_pct,
            precio_final=precio.precio_final,
        )
        for orden, (persona_in, precio) in enumerate(zip(reserva_in.personas, cotizacion.personas))
    ]
    monto_total = float(cotizacion.total)

    # 6. Preparar el objeto para la base de datos (el titular es la primera persona)
    nueva_reserva = Reserva(
        user_id=user_id,
        camping_id=camping.camping_id,
        fecha_ingreso=reserva_in.fecha_ingreso,
        fecha_egreso=reserva_in.fecha_egreso,
        cantidad_personas=cantidad_personas,
        monto_total=monto_total,
        titular=reserva_in.personas[0].nombre,
        email=reserva_in.email,
        estado_reserva=EstadoReservaEnum.PENDIENTE,
        estado_pago=EstadoPagoEnum.PENDIENTE,
        personas=personas
    )

    # 7. Transacción Atómica: la reserva y todas sus personas se guardan juntas
    try:
        db.add(nueva_reserva)
        db.commit()               # Se ejecuta la transacción
        db.refresh(nueva_reserva) # Traemos los datos frescos (como el ID autogenerado)
        return nueva_reserva
    
    except Exception as e:
        db.rollback()             # Si algo falla arriba, se revierte todo de forma segura
        import traceback; traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al procesar la reserva. Intente nuevamente."
        )

@router.get("/mias", response_model=List[ReservaDetalle])
def obtener_mis_reservas(
    db: Session = Depends(get_db),
    usuario: User = Depends(get_current_user),
):
    """Las reservas del usuario con la sesión iniciada. El usuario sale del token, no de la URL ni del body."""
    return (
        db.query(Reserva)
        .options(selectinload(Reserva.personas))
        .filter(Reserva.user_id == usuario.id)
        .order_by(Reserva.fecha_ingreso.desc(), Reserva.fecha_reserva.desc())
        .all()
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
    query = db.query(Reserva).options(selectinload(Reserva.personas))

    # Aplicamos FILTROS dinámicamente si el usuario los mandó
    if estado:
        query = query.filter(Reserva.estado_pago == estado)
    if fecha_desde:
        query = query.filter(Reserva.fecha_ingreso >= fecha_desde)

    # Aplicamos la PAGINACIÓN y ejecutamos la consulta
    reservas = query.offset(skip).limit(limit).all()

    return reservas