# Importaciones nuevas para la seguridad
from models.user import User, RoleEnum
from core.dependencies import get_current_user, get_current_user_optional, require_role

from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, selectinload

from core.config import settings
from core.database import get_db 
from schemas.cotizacion import CotizarDetalle, CotizarRequest, CotizarResponse
from schemas.reserva import ReservaCreate, ReservaDetalle, ReservaResponse
from models.reserva import (
    Reserva, ReservaPersona, EstadoPagoEnum, EstadoReservaEnum,
)
from models.configuracion import ConfiguracionCamping
from models.tipo_reserva import FormaCobroEnum, TipoReserva
from services.capacity_service import CapacityService
from services.pricing_service import Cotizacion, PersonaPrecio, PricingService
from services import socio_service
from services.camping_service import (
    CantidadPersonasError,
    obtener_o_crear_camping,
    verificar_cantidad_personas,
)
from services.tipo_reserva_service import (
    TipoReservaError,
    calcular_noches,
    obtener_tipo_activo,
    verificar_maximo_del_tipo,
    verificar_unidades_libres,
)

router = APIRouter(prefix="/reservas", tags=["Reservas"])
capacity_service = CapacityService()


def _respuesta_cotizacion(
    cotizacion: Cotizacion,
    personas: List[PersonaPrecio],
    tipo: Optional[TipoReserva] = None,
) -> CotizarResponse:
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
        forma_cobro=tipo.forma_cobro if tipo else None,
        precio_unitario=float(tipo.precio) if tipo else None,
    )


def _error_de_tipo(error: TipoReservaError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=str(error))


def _verificar_maximos(camping: ConfiguracionCamping, tipo: Optional[TipoReserva], cantidad: int) -> None:
    """Máximo general por reserva (Issue 19.1) y, si hay tipo, el máximo del tipo."""
    try:
        verificar_cantidad_personas(camping, cantidad)
        if tipo is not None:
            verificar_maximo_del_tipo(tipo, cantidad)
    except CantidadPersonasError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except TipoReservaError as error:
        raise _error_de_tipo(error)


def _es_por_unidad(tipo: Optional[TipoReserva]) -> bool:
    return tipo is not None and tipo.forma_cobro == FormaCobroEnum.POR_UNIDAD


@router.post("/cotizar", response_model=CotizarResponse)
def cotizar_reserva(cotizacion_in: CotizarRequest, db: Session = Depends(get_db)):
    """Precio de una reserva sin guardarla. Es público: no pide sesión."""
    tipo = None
    if cotizacion_in.tipo_reserva_id is not None:
        try:
            tipo = obtener_tipo_activo(db, cotizacion_in.tipo_reserva_id)
        except TipoReservaError as error:
            raise _error_de_tipo(error)
    camping = obtener_o_crear_camping(db)

    if _es_por_unidad(tipo):
        # Por unidad: precio de la unidad × noches, sin descuentos ni detalle por persona
        if cotizacion_in.personas is not None:
            raise HTTPException(
                status_code=422,
                detail="Una reserva por unidad pide solo la cantidad de personas, no los datos de cada una.",
            )
        if cotizacion_in.cantidad_personas is None:
            raise HTTPException(status_code=422, detail="Indicá la cantidad de personas.")
        if cotizacion_in.fecha_ingreso is None or cotizacion_in.fecha_egreso is None:
            raise HTTPException(status_code=422, detail="Indicá las fechas de ingreso y egreso.")
        _verificar_maximos(camping, tipo, cotizacion_in.cantidad_personas)
        try:
            noches = calcular_noches(cotizacion_in.fecha_ingreso, cotizacion_in.fecha_egreso)
        except TipoReservaError as error:
            raise _error_de_tipo(error)
        total = float(PricingService.precio_por_unidad(tipo.precio, noches))
        return CotizarResponse(
            subtotal=total,
            descuento_total=0,
            total=total,
            cantidad_socios=0,
            detalle=[],
            forma_cobro=tipo.forma_cobro,
            precio_unitario=float(tipo.precio),
            noches=noches,
        )

    # Por persona (o sin tipo): como siempre, con el precio del tipo si lo hay
    if cotizacion_in.personas is None:
        raise HTTPException(status_code=422, detail="Una reserva de este tipo necesita los datos de cada persona.")
    _verificar_maximos(camping, tipo, len(cotizacion_in.personas))
    personas = [PersonaPrecio(p.edad, p.condicion) for p in cotizacion_in.personas]
    cotizacion = PricingService.cotizar(db, personas, tipo.precio if tipo else None)
    return _respuesta_cotizacion(cotizacion, personas, tipo)


@router.post("/", response_model=ReservaResponse, status_code=status.HTTP_201_CREATED)
def crear_reserva(
    reserva_in: ReservaCreate,
    db: Session = Depends(get_db),
    usuario: Optional[User] = Depends(get_current_user_optional),
):

    # 1. Se puede reservar con o sin sesión. Con sesión la reserva queda a nombre del usuario del token
    # (ya validado por el backend); sin sesión, user_id queda en None
    user_id = usuario.id if usuario else None

    # Las pendientes con el plazo de pago cumplido se cancelan antes de contar el cupo
    capacity_service.cancelar_reservas_vencidas(db)

    # 2. El camping tiene que estar configurado, porque la reserva lo referencia
    camping = db.query(ConfiguracionCamping).filter(
        ConfiguracionCamping.camping_id == settings.CAMPING_ID
    ).first()
    if not camping:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="El camping no está configurado."
        )

    # 3. El tipo elegido (opcional por ahora). En los tipos por unidad la fila queda trabada hasta
    # el commit, para que dos pedidos simultáneos no se lleven la misma última unidad
    tipo = None
    if reserva_in.tipo_reserva_id is not None:
        try:
            tipo = obtener_tipo_activo(db, reserva_in.tipo_reserva_id)
            if _es_por_unidad(tipo):
                tipo = obtener_tipo_activo(db, tipo.id, bloquear=True)
        except TipoReservaError as error:
            raise _error_de_tipo(error)
    por_unidad = _es_por_unidad(tipo)

    # 4. Cada forma de cobro pide sus propios datos
    if por_unidad:
        if reserva_in.personas is not None:
            raise HTTPException(
                status_code=422,
                detail="Una reserva por unidad pide solo el titular y la cantidad de personas.",
            )
        if reserva_in.titular is None or reserva_in.cantidad_personas is None:
            raise HTTPException(status_code=422, detail="Indicá el titular y la cantidad de personas.")
        cantidad_personas = reserva_in.cantidad_personas
    else:
        if reserva_in.personas is None:
            raise HTTPException(
                status_code=422, detail="Una reserva de este tipo necesita los datos de cada persona."
            )
        cantidad_personas = len(reserva_in.personas)

    # 5. Máximo general por reserva (configuración guardada) y máximo del tipo
    _verificar_maximos(camping, tipo, cantidad_personas)

    # 6. Por unidad: al menos una noche y una unidad libre en cada noche
    noches = None
    if por_unidad:
        try:
            noches = calcular_noches(reserva_in.fecha_ingreso, reserva_in.fecha_egreso)
            verificar_unidades_libres(
                tipo,
                capacity_service.unidades_ocupadas(
                    db, tipo.id, reserva_in.fecha_ingreso, reserva_in.fecha_egreso
                ),
            )
        except TipoReservaError as error:
            db.rollback()  # libera la fila del tipo
            raise _error_de_tipo(error)

    # 7. Lugares ocupados en las fechas pedidas (las canceladas y las pendientes vencidas no cuentan;
    # la regla está en CapacityService). Las personas de una cabaña también cuentan
    lugares_ocupados = capacity_service.lugares_ocupados(
        db, reserva_in.fecha_ingreso, reserva_in.fecha_egreso
    )

    # 8. Validar disponibilidad con el cupo y el buffer guardados
    # El servicio lanza el error 400 si se superó el límite
    try:
        capacity_service.check_availability(
            espacios_solicitados=cantidad_personas,
            reservas_activas=lugares_ocupados,
            configuracion=camping,
        )
    except HTTPException:
        db.rollback()
        raise

    # 9. Precio. El monto lo calcula el backend, no lo manda el cliente
    if por_unidad:
        # Precio de la unidad × noches, sin descuentos por persona ni filas de personas
        personas = []
        monto_total = float(PricingService.precio_por_unidad(tipo.precio, noches))
        titular = reserva_in.titular
    else:
        # Las personas marcadas como socio tienen que validar como socio en la base
        # (membresía vigente y sin baja). Sin esto, el descuento quedaría a cargo del formulario
        try:
            socio_service.verificar_personas_socias(db, reserva_in.personas)
        except socio_service.SocioNoValidoError as error:
            raise HTTPException(status_code=422, detail=str(error))

        # Precio de cada persona y total, con la misma cuenta que usa la cotización
        cotizacion = PricingService.cotizar(
            db,
            [PersonaPrecio(p.edad, p.condicion) for p in reserva_in.personas],
            tipo.precio if tipo else None,
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
        # El titular es la primera persona
        titular = reserva_in.personas[0].nombre

    # 10. Preparar el objeto para la base de datos. Se guarda el tipo y su precio de este momento
    nueva_reserva = Reserva(
        user_id=user_id,
        camping_id=camping.camping_id,
        tipo_reserva_id=tipo.id if tipo else None,
        precio_tipo=tipo.precio if tipo else None,
        fecha_ingreso=reserva_in.fecha_ingreso,
        fecha_egreso=reserva_in.fecha_egreso,
        cantidad_personas=cantidad_personas,
        monto_total=monto_total,
        titular=titular,
        email=reserva_in.email,
        estado_reserva=EstadoReservaEnum.PENDIENTE,
        estado_pago=EstadoPagoEnum.PENDIENTE,
        personas=personas
    )

    # 11. Transacción Atómica: la reserva y todas sus personas se guardan juntas
    try:
        db.add(nueva_reserva)
        db.commit()               # Se ejecuta la transacción (y se libera la fila del tipo)
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
    capacity_service.cancelar_reservas_vencidas(db)
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
    capacity_service.cancelar_reservas_vencidas(db)

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