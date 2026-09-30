import mercadopago
from core.config import settings

class PaymentService:
    def __init__(self):
        # Inicializamos el SDK con el Access Token de las variables de entorno
        self.mp = mercadopago.SDK(settings.MERCADOPAGO_ACCESS_TOKEN)

# Instancia global para importar en los endpoints
payment_service = PaymentService()