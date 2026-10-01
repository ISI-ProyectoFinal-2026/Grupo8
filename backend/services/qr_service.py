import qrcode
from io import BytesIO
import logging

logger = logging.getLogger(__name__)

class QRService:
    @staticmethod
    def generar_qr_desde_jwt(jwt_token: str) -> bytes:
        """
        Transforma el token criptográfico JWT en una imagen QR real (DoD 11.2).
        Retorna los bytes de la imagen PNG, optimizados para adjuntar por email.
        """
        try:
            # 1. Configuración del diseño del QR
            qr = qrcode.QRCode(
                version=1, # Se ajustará automáticamente si el JWT es muy largo
                error_correction=qrcode.constants.ERROR_CORRECT_M, # Tolerancia a daños del 15% (ideal para escanear en pantallas o impreso)
                box_size=10, # Tamaño de los píxeles
                border=4, # Borde blanco reglamentario
            )
            
            # 2. Inyectamos el payload (el token JWT firmado)
            qr.add_data(jwt_token)
            qr.make(fit=True)

            # 3. Renderizamos la imagen visual
            img = qr.make_image(fill_color="black", back_color="white")

            # 4. Guardamos la imagen en un buffer de memoria RAM
            img_buffer = BytesIO()
            img.save(img_buffer, format="PNG")
            
            logger.info("Imagen QR generada exitosamente en memoria RAM.")
            
            # Retornamos el archivo convertido a bytes
            return img_buffer.getvalue()
            
        except Exception as e:
            logger.error(f"Fallo al generar visualmente el código QR: {str(e)}")
            raise ValueError("No se pudo generar la imagen del Código QR")

# Exportamos la instancia para usarla luego en el controlador de reservas
qr_service = QRService()