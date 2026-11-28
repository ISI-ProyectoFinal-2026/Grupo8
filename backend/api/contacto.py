"""Formulario de Contacto de la web de reservas (Issue 31.5). Público: lo usa cualquier visitante."""
import logging

from fastapi import APIRouter, HTTPException, Request, status

from core.config import settings
from schemas.contacto import ContactoRespuesta, ContactoSolicitud
from services.contacto_service import (
    ERROR_ENVIO,
    ERROR_NO_CONFIGURADO,
    MENSAJE_ENVIADO,
    limite_de_envios,
    mensaje_de_espera,
)
from services.email_service import email_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/contacto", tags=["Contacto"])


def _ip_del_visitante(request: Request) -> str:
    """Con proxy (Render) la conexión llega desde el proxy: la IP real es el último valor de X-Forwarded-For,
    el que agregó el proxy. Los anteriores los puede escribir el propio visitante."""
    if settings.CONTACTO_IP_DESDE_PROXY:
        reenviadas = request.headers.get("x-forwarded-for", "")
        ultima = reenviadas.split(",")[-1].strip()
        if ultima:
            return ultima
    return request.client.host if request.client else "desconocida"


@router.post("", response_model=ContactoRespuesta, status_code=status.HTTP_202_ACCEPTED)
def enviar_contacto(datos: ContactoSolicitud, request: Request):
    """Envía el mensaje al correo del camping (CONTACTO_EMAIL_DESTINO) con Resend. Solo responde éxito si
    Resend aceptó el envío: 429 si superó el límite, 502 si Resend falló, 503 si no hay destinatario configurado."""
    destinatario = settings.CONTACTO_EMAIL_DESTINO.strip()
    if not destinatario:
        logger.error("Contacto: falta configurar CONTACTO_EMAIL_DESTINO, no se envió el mensaje.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=ERROR_NO_CONFIGURADO)

    espera = limite_de_envios.intentar(_ip_del_visitante(request))
    if espera:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=mensaje_de_espera(espera),
            headers={"Retry-After": str(espera)},
        )

    try:
        email_service.enviar_contacto(destinatario, settings.CONTACTO_EMAIL_REMITENTE, datos.model_dump())
    except Exception as e:
        # Se registra el tipo y el motivo, sin la clave; al visitante no se le muestra nada interno
        motivo = str(e).replace(settings.RESEND_API_KEY, "***") if settings.RESEND_API_KEY else str(e)
        logger.error(f"Contacto: Resend no pudo enviar el mensaje ({type(e).__name__}): {motivo}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=ERROR_ENVIO)
    return ContactoRespuesta(mensaje=MENSAJE_ENVIADO)
