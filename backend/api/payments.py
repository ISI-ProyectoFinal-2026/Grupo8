from sqlalchemy import text
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from services.payment_service import payment_service
from core.database import get_db
from models.reserva import Reserva, EstadoPagoEnum

router = APIRouter(
    prefix="/api/payments",
    tags=["Pagos"]
)

class PaymentRequest(BaseModel):
    title: str
    unit_price: float
    payer_email: str
    reserva_id: str # id reserva

@router.post("/create", summary="Crear preferencia de pago")
async def create_payment_preference(request: PaymentRequest):
    preference_data = {
        "items": [
            {
                "title": request.title,
                "quantity": 1,
                "unit_price": request.unit_price,
                "currency_id": "ARS"
            }
        ],
        "back_urls": {
            "success": "http://localhost:5173/pago/exito",
            "failure": "http://localhost:5173/pago/rechazado",
            "pending": "http://localhost:5173/pago/pendiente"
        },

        # Descomentar auto_return cuando se suba a producción, Mercado Pago no permite la función auto_return con dominios locales.
        # Pasa lo mismo con querer hacer el flujo completo con las back_urls. MP no permite redireccionar a direcciones tipo localhost. En producción deberian andar bien (pq no va a hacer localhost, va a ser una https).
        #"auto_return": "approved",
        
        "external_reference": request.reserva_id,

        # le pasamos la url directamente a Mercado Pago
        "notification_url": "https://party-unhook-ambiguous.ngrok-free.dev/api/payments/webhook"
    }

    try:
        preference_response = payment_service.mp.preference().create(preference_data)

        if preference_response.get("status") not in (200, 201):
            raise HTTPException(status_code=400, detail="Rechazado por Mercado Pago")

        # Para pasar a producción real, cambiá "sandbox_init_point" por "init_point"
        return {"init_point": preference_response["response"]["sandbox_init_point"]}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/webhook", summary="Recibir notificaciones de Mercado Pago")
async def payment_webhook(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
        print("====== AVISO DE MERCADO PAGO RECIBIDO ======")
        
        if body.get("type") == "payment" or body.get("topic") == "payment":
            payment_id = body.get("data", {}).get("id")
            
            if payment_id:
                # SEGURIDAD: Consultamos el estado real a Mercado Pago
                payment_info = payment_service.mp.payment().get(payment_id)
                
                if payment_info["status"] == 200:
                    estado_pago = payment_info["response"]["status"]
                    
                    # Recuperamos el ID de la reserva que mandamos en /create
                    reserva_id = payment_info["response"].get("external_reference")
                    
                    print(f"El pago {payment_id} es real y su estado es: {estado_pago}")
                    
                    if estado_pago == "approved" and reserva_id:
                        # ==========================================
                        # LÓGICA DE BASE DE DATOS
                        # ==========================================
                        # 1. Buscar la reserva por el ID
                        reserva = db.query(Reserva).filter(Reserva.id == reserva_id).first()
                        
                        if reserva:
                            # 2. EVITAR DUPLICADOS (DoD 3): Si ya está pagada, no hacemos nada
                            if reserva.estado_pago == EstadoPagoEnum.PAGADO:
                                print(f"La reserva {reserva_id} ya figuraba como PAGADA. Ignorando aviso duplicado.")
                            else:
                                # 3. ACTUALIZAR (DoD 2): La pasamos a Pagada y guardamos
                                reserva.estado_pago = EstadoPagoEnum.PAGADO
                                db.commit()
                                print(f"¡Éxito! Reserva {reserva_id} actualizada a PAGADO en PostgreSQL.")
                                
                                # TODO: Acá iría la llamada a la función que manda el QR por mail
                        else:
                            print(f"Alerta: No se encontró la reserva {reserva_id} en la BD.")
                            
                    elif estado_pago == "rejected":
                        print("El pago fue rechazado. Lógica de cancelación pendiente...")

        # SIEMPRE responder 200 OK
        return {"status": "ok"}
        
    except Exception as e:
        print(f"Error procesando webhook: {e}")
        return {"status": "ok"}

@router.get("/test-user", summary="Obtener un ID de usuario temporal")
def get_test_user(db: Session = Depends(get_db)):
    resultado = db.execute(text("SELECT id FROM usuarios LIMIT 1")).fetchone()
    return {"user_id": str(resultado[0]) if resultado else "No hay usuarios"}