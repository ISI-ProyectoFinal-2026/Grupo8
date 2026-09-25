from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from services.payment_service import payment_service

router = APIRouter(
    prefix="/api/payments",
    tags=["Pagos"]
)

class PaymentRequest(BaseModel):
    title: str
    unit_price: float
    payer_email: str

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
            "success": "http://localhost:5173/mis-reservas",
            "failure": "http://localhost:5173/",
            "pending": "http://localhost:5173/mis-reservas"
        },

        # Descomentar auto_return cuando se suba a producción, Mercado Pago no permite la función auto_return con dominios locales
        # "auto_return": "approved",
        
        # le pasamos la url directamente a Mercado Pago
        #"notification_url": "https://party-unhook-ambiguous.ngrok-free.dev/api/payments/webhook"
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
async def payment_webhook(request: Request):
    try:
        # 1. Leer el mensaje que manda Mercado Pago
        body = await request.json()
        print("====== AVISO DE MERCADO PAGO RECIBIDO ======")
        print(body)
        
        # 2. Filtrar solo los avisos de tipo "pago"
        # Mercado Pago envía 'type' o 'topic' dependiendo de la versión del webhook
        if body.get("type") == "payment" or body.get("topic") == "payment":
            payment_id = body.get("data", {}).get("id")
            
            if payment_id:
                # 3. SEGURIDAD: Le preguntamos a la API oficial de MP el estado de ese pago
                payment_info = payment_service.mp.payment().get(payment_id)
                
                if payment_info["status"] == 200:
                    estado_pago = payment_info["response"]["status"]
                    
                    print(f"El pago {payment_id} es real y su estado es: {estado_pago}")
                    
                    if estado_pago == "approved":
                        # ==========================================
                        # ACÁ VA LA LÓGICA DE TU BASE DE DATOS
                        # ==========================================
                        # 1. Buscar la reserva en tu BD
                        # 2. Cambiarle el estado a "Pagada" / "Confirmada"
                        # 3. Disparar el envío de correo con el código QR
                        print("¡Plata en mano! Actualizando la reserva en la base de datos...")
                        
                    elif estado_pago == "rejected":
                        print("El pago fue rechazado. Liberando el lugar en el camping...")
                        # Lógica para cancelar la reserva
                        
        # 4. SIEMPRE hay que responderle un 200 OK rápido a Mercado Pago
        # Si no lo hacés, creen que tu servidor se cayó y te mandan el aviso mil veces
        return {"status": "ok"}
        
    except Exception as e:
        print(f"Error procesando webhook: {e}")
        # Retornamos 200 igual para que MP no se trabe reintentando infinitamente
        return {"status": "ok"}