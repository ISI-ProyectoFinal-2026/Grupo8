from fastapi import APIRouter

router = APIRouter(
    prefix="/api/payments",
    tags=["Pagos"]
)

@router.post("/create", summary="Crear preferencia de pago")
async def create_payment_preference():
    """
    Endpoint inicial para generar la preferencia de pago en Mercado Pago (Sub-issue 10.2).
    """
    return {"status": "ok", "message": "Endpoint /create configurado correctamente"}

@router.post("/webhook", summary="Recibir notificaciones de Mercado Pago")
async def payment_webhook():
    """
    Endpoint para recibir webhooks de actualización de estado de Mercado Pago (Sub-issue 10.3).
    """
    return {"status": "ok", "message": "Endpoint /webhook configurado correctamente"}