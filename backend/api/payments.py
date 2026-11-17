import logging

from sqlalchemy import text
from fastapi import APIRouter, HTTPException, Request, Depends, BackgroundTasks, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from services.payment_service import (
    ResultadoConfirmacion,
    aviso_autentico,
    confirmar_pago,
    payment_service,
    registrar_pago,
    url_de_avisos,
    urls_de_retorno,
    usa_retorno_automatico,
)
from core.config import settings
from services.capacity_service import plazo_vencido, vencimiento_pago
from core.database import get_db
from core.dependencies import get_current_user
from models.reserva import Reserva, EstadoPagoEnum, EstadoReservaEnum
from models.user import RoleEnum, User
from schemas.estado_pago import EstadoPagoRetorno, EstadoRetorno, ReservaRetorno
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/payments",
    tags=["Pagos"]
)

def _registrar_pagos(db: Session, pagos_mp: list) -> None:
    """Guarda en la tabla pagos lo que informó Mercado Pago.
    Si falla, se registra el error y se sigue: no debe frenar la confirmación de la reserva."""
    try:
        for datos in pagos_mp:
            if isinstance(datos, dict):
                registrar_pago(db, datos)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Error registrando el pago en la tabla pagos")


class PaymentRequest(BaseModel):
    title: str
    reserva_id: uuid.UUID

@router.post("/create", summary="Crear preferencia de pago")
async def create_payment_preference(request: PaymentRequest, db: Session = Depends(get_db)):
    # El monto sale de la reserva guardada, no de lo que mande el cliente
    reserva = db.query(Reserva).filter(Reserva.id == request.reserva_id).first()
    if not reserva:
        raise HTTPException(status_code=404, detail="Reserva no encontrada en la base de datos.")

    # Pasado el plazo no se abre un checkout nuevo: la reserva ya no tiene el cupo guardado
    if plazo_vencido(reserva):
        raise HTTPException(
            status_code=409,
            detail="El plazo para pagar la reserva venció. Hacé una nueva reserva.",
        )

    # Detectar y evitar cobro duplicado
    # 1) Chequeo local: solo se cobra una reserva pendiente de pago y no cancelada.
    if reserva.estado_pago != EstadoPagoEnum.PENDIENTE or reserva.estado_reserva == EstadoReservaEnum.CANCELADA:
        raise HTTPException(
            status_code=409,
            detail="La reserva no admite un nuevo pago (ya fue pagada o está cancelada).",
        )

    preference_data = {
        "items": [
            {
                "title": request.title,
                "quantity": 1,
                "unit_price": reserva.monto_total,
                "currency_id": "ARS"
            }
        ],
        "back_urls": urls_de_retorno(),
        "external_reference": str(reserva.id),

        # El link de pago vence junto con el plazo de la reserva
        "expires": True,
        "expiration_date_to": vencimiento_pago(reserva.fecha_reserva).isoformat(timespec="milliseconds"),
        # Sin efectivo (Pago Fácil, Rapipago): se acredita días después, con la reserva ya vencida
        "payment_methods": {"excluded_payment_types": [{"id": "ticket"}, {"id": "atm"}]},
    }

    # Con el pago aprobado, Mercado Pago devuelve solo al cliente a la web
    if usa_retorno_automatico():
        preference_data["auto_return"] = "approved"

    notification_url = url_de_avisos()
    if notification_url:
        preference_data["notification_url"] = notification_url

    try:
        # 2) Chequeo contra MP: si ya cobró (p. ej. el webhook falló), no se abre otro checkout.
        #    Si esta consulta falla, se bloquea el cobro (500) en lugar de arriesgar un cargo doble.
        busqueda = payment_service.mp.payment().search({"external_reference": str(reserva.id)})
        pagos_mp = busqueda.get("response", {}).get("results", [])
        if any(pago.get("status") == "approved" for pago in pagos_mp):
            raise HTTPException(
                status_code=409,
                detail="Mercado Pago ya registra un pago aprobado para esta reserva. Verificá el pago desde Mis reservas.",
            )

        preference_response = payment_service.mp.preference().create(preference_data)

        if preference_response.get("status") not in (200, 201):
            raise HTTPException(status_code=400, detail="Rechazado por Mercado Pago")

        # Para pasar a producción real, cambiá "sandbox_init_point" por "init_point"
        return {"init_point": preference_response["response"]["sandbox_init_point"]}
    
    except HTTPException:
        # No convertir los 400/409 propios en 500
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/webhook", summary="Recibir notificaciones de Mercado Pago")
async def payment_webhook(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # La firma cubre el data.id de la URL: un aviso falso o modificado no se procesa
    id_url = request.query_params.get("data.id")
    if not aviso_autentico(request.headers.get("x-signature"), request.headers.get("x-request-id"), id_url):
        raise HTTPException(status_code=401, detail="Firma del aviso inválida.")

    try:
        body = await request.json()
        logger.info(f"Aviso de Mercado Pago recibido (tipo: {body.get('type') or body.get('topic')})")

        if body.get("type") == "payment" or body.get("topic") == "payment":
            # El id del cuerpo solo se usa si no vino en la URL; en ese caso la firma
            # se validó sin id, algo que Mercado Pago no envía para avisos de pago reales
            payment_id = id_url or body.get("data", {}).get("id")
            
            if payment_id:
                # No se confía en el aviso: el estado real se le pregunta a Mercado Pago
                payment_info = payment_service.mp.payment().get(payment_id)
                
                if payment_info["status"] == 200:
                    datos_pago = payment_info["response"]

                    # Cada aviso queda registrado, sea cual sea el estado del pago
                    _registrar_pagos(db, [datos_pago])

                    estado_pago = datos_pago["status"]
                    # external_reference es el id de la reserva que se mandó en /create
                    reserva_id = datos_pago.get("external_reference")
                    logger.info(f"Pago {payment_id} verificado en Mercado Pago, estado: {estado_pago}")

                    if estado_pago == "approved" and reserva_id:
                        resultado = confirmar_pago(
                            db, reserva_id, background_tasks,
                            monto_cobrado=datos_pago.get("transaction_amount"),
                            mp_payment_id=datos_pago.get("id"),
                        )
                        if resultado == ResultadoConfirmacion.CONFIRMADA:
                            logger.info(f"Reserva {reserva_id} actualizada a PAGADO. Correo con el QR en camino.")
                        elif resultado == ResultadoConfirmacion.IMPORTE_DISTINTO:
                            logger.warning(f"Reserva {reserva_id} sin confirmar: el importe cobrado no coincide.")
                        elif resultado == ResultadoConfirmacion.REEMBOLSADA:
                            logger.warning(f"Reserva {reserva_id} vencida y sin cupo: se reembolsó el pago {payment_id}.")
                        elif resultado == ResultadoConfirmacion.REEMBOLSO_PENDIENTE:
                            logger.error(
                                f"Reserva {reserva_id} vencida y sin cupo: falló el reembolso del pago {payment_id}."
                            )
                        else:
                            logger.info(f"La reserva {reserva_id} ya figuraba como pagada o no existe. Aviso ignorado.")

                    elif estado_pago == "rejected":
                        # La reserva sigue pendiente: se puede reintentar con otro medio de pago
                        # mientras dure el plazo de pago
                        logger.info(
                            f"Pago {payment_id} rechazado ({datos_pago.get('status_detail')}). "
                            f"La reserva {reserva_id} sigue pendiente."
                        )

        # Siempre 200: con cualquier otra respuesta Mercado Pago reintenta el mismo aviso
        return {"status": "ok"}

    except Exception:
        logger.exception("Error procesando el aviso de Mercado Pago")
        return {"status": "ok"}

@router.get("/test-user", summary="Obtener un ID de usuario temporal")
def get_test_user(db: Session = Depends(get_db)):
    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(status_code=404, detail="Endpoint no disponible en producción.")
    resultado = db.execute(text("SELECT id FROM usuarios LIMIT 1")).fetchone()
    return {"user_id": str(resultado[0]) if resultado else "No hay usuarios"}


@router.get("/reconcile/{reserva_id}", summary="Reconciliar operación huérfana manual")
def reconciliar_pago(
    reserva_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    usuario: User = Depends(get_current_user),
):
    """Confirma una reserva cuyo aviso de Mercado Pago nunca llegó.

    Busca en Mercado Pago los pagos asociados a la reserva y, si hay uno aprobado, sigue el mismo
    camino que el webhook. Lo usa la verificación de pago de Mis reservas; un administrador
    también puede llamarlo para cualquier reserva.
    """
    reserva = db.query(Reserva).filter(Reserva.id == reserva_id).first()
    
    if not reserva:
        raise HTTPException(status_code=404, detail="Reserva no encontrada en la base de datos.")

    # Las reservas sin cuenta no tienen dueño: solo un administrador puede verificarlas
    if usuario.rol != RoleEnum.ADMIN and reserva.user_id != usuario.id:
        raise HTTPException(
            status_code=403,
            detail="Solo el dueño de la reserva o un administrador puede verificar el pago.",
        )

    # Si la reserva ya fue pagada, frenamos el proceso para no hacer peticiones innecesarias.
    # Las canceladas por vencimiento sí se consultan: puede haber entrado un pago tarde
    if reserva.estado_pago == EstadoPagoEnum.PAGADO:
        return {"status": "ok", "message": f"La reserva ya se encuentra en estado: {reserva.estado_pago.value}"}

    try:
        respuesta_mp = payment_service.mp.payment().search({"external_reference": str(reserva_id)})
        pagos_encontrados = respuesta_mp.get("response", {}).get("results", [])

        # Se registran todos los intentos que informa Mercado Pago, no solo el aprobado
        _registrar_pagos(db, pagos_encontrados)

        pago_aprobado = next((pago for pago in pagos_encontrados if pago.get("status") == "approved"), None)

        if pago_aprobado:
            # Mismo camino que el webhook: confirma la reserva y manda el QR una sola vez
            resultado = confirmar_pago(
                db, reserva.id, background_tasks,
                monto_cobrado=pago_aprobado.get("transaction_amount"),
                mp_payment_id=pago_aprobado.get("id"),
            )
            if resultado in (ResultadoConfirmacion.REEMBOLSADA, ResultadoConfirmacion.REEMBOLSO_PENDIENTE):
                return {
                    "status": "reembolsado" if resultado == ResultadoConfirmacion.REEMBOLSADA else "reembolso_pendiente",
                    "message": "El pago llegó después del plazo y ya no había lugar: la reserva quedó cancelada "
                    "y se devuelve el dinero. Te avisamos por correo.",
                    "pago_id_mp": pago_aprobado.get("id"),
                }
            if resultado == ResultadoConfirmacion.IMPORTE_DISTINTO:
                return {
                    "status": "importe_distinto",
                    "message": "El importe cobrado no coincide con el de la reserva. El pago quedó registrado para revisión.",
                    "pago_id_mp": pago_aprobado.get("id"),
                }

            return {
                "status": "reconciliado",
                "message": "Se encontró el pago en Mercado Pago. Reserva actualizada a PAGADO.",
                "pago_id_mp": pago_aprobado.get("id")
            }
        elif plazo_vencido(reserva):
            return {
                "status": "vencida",
                "message": "El plazo para pagar la reserva venció y no hay pagos aprobados en Mercado Pago.",
            }
        else:
            return {
                "status": "pendiente",
                "message": "No se encontraron pagos aprobados en Mercado Pago para esta reserva."
            }

    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error de red al intentar consultar a Mercado Pago: {str(e)}"
        )


# --- Estado del pago al volver de Mercado Pago (sin sesión) ---

DATOS_NO_COINCIDEN = "No encontramos un pago de Mercado Pago para esta reserva."
SIN_RESPUESTA_MP = "No pudimos consultar el pago en Mercado Pago. Intentá de nuevo en unos segundos."

# Estados de Mercado Pago de un pago que todavía se puede aprobar
_PAGO_EN_PROCESO = {"pending", "in_process", "authorized"}

_MENSAJES: dict[str, str] = {
    "confirmada": "Tu pago fue acreditado y la reserva está confirmada.",
    "en_proceso": "Estamos confirmando tu pago.",
    "rechazado": "El pago no fue aprobado. Tu reserva no está confirmada.",
    "cancelada": "La reserva fue cancelada. Si se te cobró, te avisamos por correo cómo se devuelve el dinero.",
    "revision": "Recibimos tu pago, pero tenemos que revisarlo antes de confirmar la reserva. Te escribimos por correo.",
}


def _estado_de_la_reserva(reserva: Reserva, estado_mp: str, resultado: ResultadoConfirmacion | None) -> EstadoRetorno:
    if reserva.estado_reserva == EstadoReservaEnum.CANCELADA:
        return "cancelada"
    if reserva.estado_pago == EstadoPagoEnum.PAGADO:
        return "confirmada"
    if resultado == ResultadoConfirmacion.IMPORTE_DISTINTO:
        return "revision"
    if estado_mp == "approved" or estado_mp in _PAGO_EN_PROCESO:
        return "en_proceso"
    return "rechazado"


@router.get(
    "/estado/{reserva_id}",
    response_model=EstadoPagoRetorno,
    summary="Estado del pago al volver de Mercado Pago",
)
def estado_del_pago(
    reserva_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    payment_id: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
):
    """Lo usa la pantalla /pago/exito, también para los visitantes que reservan sin cuenta.

    No confía en la URL: le pregunta a Mercado Pago por el pago y comprueba que su
    external_reference sea esta reserva. Si está aprobado y la reserva sigue pendiente, la
    confirma por el mismo camino que el webhook y la reconciliación, así que consultarlo varias
    veces no la confirma ni manda el correo dos veces.
    """
    reserva = db.query(Reserva).filter(Reserva.id == reserva_id).first()
    if reserva is None:
        raise HTTPException(status_code=404, detail=DATOS_NO_COINCIDEN)

    try:
        respuesta_mp = payment_service.mp.payment().get(payment_id)
    except Exception:
        logger.exception(f"No se pudo consultar el pago {payment_id} en Mercado Pago")
        raise HTTPException(status_code=503, detail=SIN_RESPUESTA_MP)

    estado_http = respuesta_mp.get("status")
    if estado_http == 404:
        raise HTTPException(status_code=404, detail=DATOS_NO_COINCIDEN)
    if estado_http != 200:
        raise HTTPException(status_code=503, detail=SIN_RESPUESTA_MP)

    datos_pago = respuesta_mp.get("response") or {}
    if str(datos_pago.get("external_reference")) != str(reserva.id):
        raise HTTPException(status_code=404, detail=DATOS_NO_COINCIDEN)

    _registrar_pagos(db, [datos_pago])

    estado_mp = str(datos_pago.get("status"))
    resultado = None
    if estado_mp == "approved":
        resultado = confirmar_pago(
            db, reserva.id, background_tasks,
            monto_cobrado=datos_pago.get("transaction_amount"),
            mp_payment_id=datos_pago.get("id"),
        )
        db.refresh(reserva)

    estado = _estado_de_la_reserva(reserva, estado_mp, resultado)
    return EstadoPagoRetorno(
        estado=estado,
        mensaje=_MENSAJES[estado],
        reserva=ReservaRetorno(
            id=reserva.id,
            codigo=f"#{str(reserva.id)[:8]}",
            fecha_ingreso=reserva.fecha_ingreso,
            fecha_egreso=reserva.fecha_egreso,
            cantidad_personas=reserva.cantidad_personas,
        ),
    )
