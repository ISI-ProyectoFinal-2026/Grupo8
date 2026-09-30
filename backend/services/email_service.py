import resend
from core.config import settings
import logging

# Configuramos el logger
logger = logging.getLogger(__name__)

# Inicializamos el SDK de Resend con la clave segura
resend.api_key = settings.RESEND_API_KEY

class EmailService:
    @staticmethod
    async def enviar_correo_prueba(destinatario: str):
        """
        Función para validar la conexión inicial con Resend.
        """
        try:
            # Resend nos da el dominio onboarding@resend.dev para hacer pruebas
            params: resend.Emails.SendParams = {
                "from": "Qamp Accesos <onboarding@resend.dev>",
                "to": [destinatario],
                "subject": "Prueba de conexión - Qamp",
                "html": "<strong>¡La configuración del módulo de notificaciones (Issue 11.1) fue un éxito!</strong>"
            }
            
            email = resend.Emails.send(params)
            logger.info(f"Correo de prueba enviado exitosamente. ID: {email['id']}")
            return {"status": "success", "id": email['id']}
            
        except Exception as e:
            logger.error(f"Fallo al enviar correo con Resend: {str(e)}")
            raise e

# Exportamos una instancia lista para usar
email_service = EmailService()