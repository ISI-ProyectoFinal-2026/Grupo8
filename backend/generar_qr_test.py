import time
import uuid
import qrcode
from security.services import SecurityService
from security.schemas import JWTPayloadSchema
from security.config import settings


# Este test solo sirve para generar un qr para testearlo junto con la aplicacion nada mas

def generar_qr_prueba():
    print("Iniciando generación de QR de prueba...")
    
    # 1. Generamos timestamps dinámicos para que el token no esté expirado
    # El frontend (jose) rechazará el token si el claim 'exp' es menor a la fecha actual
    fecha_actual = int(time.time())
    
    datos_reserva = {
        "jti": str(uuid.uuid4()), 
        "reserva_id": "6cad7a24-0843-4326-bfd9-f909182b9d4a", # Un UUID de prueba válido
        "camping_id": "CAMP-01", # Ahora es un string
        "iat": fecha_actual,
        "cantidad_personas": 4,
        "typ": "visitante",
        "exp": fecha_actual + (60 * 60 * 24),
        "dat": "2026-07-30" 
    }
    
    try:
        # 2. Validamos los datos con tu esquema de Pydantic
        payload = JWTPayloadSchema(**datos_reserva)
        
        # 3. Instanciamos tu servicio de seguridad inyectando la clave privada
        if not settings.jwt_private_key:
            raise ValueError("No se encontró JWT_PRIVATE_KEY en las variables de entorno.")
            
        service = SecurityService(private_key=settings.jwt_private_key)
        
        # 4. Generamos el JWT firmado
        token = service.generate_offline_qr_token(payload)
        
        # 5. Creamos la imagen del QR
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(token)
        qr.make(fit=True)
        
        img = qr.make_image(fill_color="black", back_color="white")
        
        # 6. Guardamos la imagen en el disco
        nombre_archivo = "qr_test_acceso.png"
        img.save(nombre_archivo)
        
        print(f"\n✅ ÉXITO: Código QR generado y guardado como '{nombre_archivo}'")
        print(f"Token interno (solo para debug):\n{token}\n")
        
    except Exception as e:
        print(f"\n❌ ERROR al generar el QR: {e}")

if __name__ == "__main__":
    generar_qr_prueba()