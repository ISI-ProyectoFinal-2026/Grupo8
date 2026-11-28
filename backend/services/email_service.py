import resend
from core.config import settings
from jinja2 import Environment, FileSystemLoader
from services.qr_service import qr_service
import logging
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger(__name__)
resend.api_key = settings.RESEND_API_KEY

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "emails" 

template_env = Environment(
    loader=FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),  # evita inyección HTML con datos como el titular
)

class EmailService:
    @staticmethod
    def enviar_confirmacion_sync(destinatario: str, datos_reserva: dict, jwt_token: str):
        """
        Renderiza la plantilla HTML, genera el QR y despacha el correo.
        Diseñada para ejecutarse en segundo plano (BackgroundTasks).
        """
        try:
            # El QR se genera en memoria: no se escribe ningún archivo en el servidor
            qr_bytes = qr_service.generar_qr_desde_jwt(jwt_token)

            template = template_env.get_template("confirmacion_reserva.html")
            html_content = template.render(**datos_reserva)

            params: resend.Emails.SendParams = {
                "from": "Qamp Accesos <onboarding@resend.dev>",
                "to": [destinatario],
                "subject": "¡Tu reserva en Qamp está confirmada! 🏕️",
                "html": html_content,
                "attachments": [
                    {
                        "filename": f"QR_Acceso_{datos_reserva.get('reserva_id', 'Qamp')}.png",
                        # El SDK de Resend en Python requiere convertir los bytes a una lista de enteros
                        "content": list(qr_bytes),
                        "content_id": "qr_code",
                    }
                ]
            }
            
            # 4. Disparamos el correo
            email = resend.Emails.send(params)
            logger.info(f"Correo de confirmación despachado con éxito. ID: {email['id']}")
            
        except Exception as e:
            # Capturamos el error pero NO usamos "raise" para no crashear el hilo secundario
            logger.error(f"Error crítico en hilo secundario al enviar correo: {str(e)}")

    @staticmethod
    def enviar_contacto(destinatario: str, remitente: str, datos: dict) -> None:
        """Mensaje del formulario de Contacto al correo del camping. datos lleva nombre, email y mensaje.
        A diferencia de los demás, se envía en el momento y NO captura el error: quien llama tiene que
        saber si Resend falló para no avisarle al visitante que su mensaje salió."""
        template = template_env.get_template("contacto_mensaje.html")
        params: resend.Emails.SendParams = {
            "from": remitente,
            "to": [destinatario],
            # Al responder el correo, la respuesta va al visitante
            "reply_to": datos["email"],
            "subject": f"Consulta desde la web de {datos['nombre']}",
            "html": template.render(**datos),
        }
        email = resend.Emails.send(params)
        logger.info(f"Mensaje de contacto despachado con éxito. ID: {email['id']}")

    @staticmethod
    def enviar_cancelacion_sync(destinatario: str, datos_reserva: dict):
        """Avisa que la reserva quedó cancelada. datos_reserva lleva nombre_cliente, reserva_id y
        motivo_cancelacion, y opcionalmente detalle_devolucion (cuánto se devuelve y cómo)."""
        try:
            template = template_env.get_template("cancelacion_reserva.html")
            params: resend.Emails.SendParams = {
                "from": "Qamp Accesos <onboarding@resend.dev>",
                "to": [destinatario],
                "subject": "Aviso sobre tu reserva en Qamp",
                "html": template.render(**datos_reserva),
            }
            email = resend.Emails.send(params)
            logger.info(f"Correo de cancelación despachado con éxito. ID: {email['id']}")
        except Exception as e:
            logger.error(f"Error crítico en hilo secundario al enviar correo de cancelación: {str(e)}")

    @staticmethod
    def enviar_enlaces_arrepentimiento_sync(destinatario: str, datos: dict):
        """Botón de arrepentimiento: un enlace por reserva. datos lleva reservas (lista con reserva_id,
        fechas, personas, monto y enlace) y minutos de validez de los enlaces."""
        try:
            template = template_env.get_template("arrepentimiento_enlaces.html")
            params: resend.Emails.SendParams = {
                "from": "Qamp Accesos <onboarding@resend.dev>",
                "to": [destinatario],
                "subject": "Botón de arrepentimiento: cancelá tu reserva en Qamp",
                "html": template.render(**datos),
            }
            email = resend.Emails.send(params)
            logger.info(f"Correo de arrepentimiento despachado con éxito. ID: {email['id']}")
        except Exception as e:
            logger.error(f"Error crítico en hilo secundario al enviar correo de arrepentimiento: {str(e)}")


email_service = EmailService()