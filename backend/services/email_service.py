import resend
from core.config import settings
from jinja2 import Environment, FileSystemLoader
from services.qr_service import qr_service
import logging

logger = logging.getLogger(__name__)
resend.api_key = settings.RESEND_API_KEY

# Inicializamos Jinja2 apuntando a la carpeta que creaste en la 11.3
template_env = Environment(loader=FileSystemLoader("../templates/emails"))

class EmailService:
    @staticmethod
    def enviar_confirmacion_async(destinatario: str, datos_reserva: dict, jwt_token: str):
        """
        Renderiza la plantilla HTML, genera el QR y despacha el correo.
        Diseñada para ejecutarse en segundo plano (BackgroundTasks).
        """
        try:
            # 1. Generamos el QR en memoria RAM (Issue 11.2)
            qr_bytes = qr_service.generar_qr_desde_jwt(jwt_token)

            # 2. Renderizamos la plantilla con los datos dinámicos (Issue 11.3)
            template = template_env.get_template("confirmacion_reserva.html")
            html_content = template.render(**datos_reserva)

            # 3. Armamos el paquete para Resend
            params: resend.Emails.SendParams = {
                "from": "Qamp Accesos <onboarding@resend.dev>",
                "to": [destinatario],
                "subject": "¡Tu reserva en Qamp está confirmada! 🏕️",
                "html": html_content,
                "attachments": [
                    {
                        "filename": f"QR_Acceso_{datos_reserva.get('reserva_id', 'Qamp')}.png",
                        # El SDK de Resend en Python requiere convertir los bytes a una lista de enteros
                        "content": list(qr_bytes) 
                    }
                ]
            }
            
            # 4. Disparamos el correo
            email = resend.Emails.send(params)
            logger.info(f"Correo de confirmación despachado con éxito. ID: {email['id']}")
            
        except Exception as e:
            # Capturamos el error pero NO usamos "raise" para no crashear el hilo secundario
            logger.error(f"Error crítico en hilo secundario al enviar correo: {str(e)}")

email_service = EmailService()