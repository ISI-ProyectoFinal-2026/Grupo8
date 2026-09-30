import os
import time
import uuid
from datetime import datetime, timedelta
import qrcode

from core.database import SessionLocal
from models.user import User, RoleEnum
from models.reserva import Reserva, EstadoPagoEnum
from security.services import SecurityService
from security.schemas import JWTPayloadSchema
from security.config import settings

# Creamos la sesión
db = SessionLocal()

def run_seed_con_qrs():
    print("--- Iniciando Seeding y Generación de QRs ---")
    
    # 1. Limpiar la BD (IMPORTANTE: primero reservas porque dependen de usuarios)
    db.query(Reserva).delete()
    db.query(User).delete()
    db.commit()
    print("Base de datos limpia.")

    # 2. Crear Admin y Guardia
    admin = User(email="admin@camping.com", password_hash="admin123", nombre="Admin", dni="111", rol=RoleEnum.ADMIN)
    guardia = User(email="guardia@camping.com", password_hash="admin123", nombre="Guardia", dni="222", rol=RoleEnum.SEGURIDAD)
    db.add_all([admin, guardia])
    db.commit()
    print("Usuarios base creados.")

    # 3. Crear 5 usuarios (2 socios, 3 visitantes)
    usuarios = []
    for i in range(5):
        es_socio = i < 2
        u = User(
            email=f"user{i}@test.com", 
            password_hash="pass123", 
            nombre=f"Persona {i}", 
            dni=f"333{i}", 
            is_socio=es_socio
        )
        usuarios.append(u)
    db.add_all(usuarios)
    db.commit()

    # 4. Crear reservas (10 pasadas, 5 futuras)
    reservas = []
    for i in range(15):
        fecha = datetime.utcnow() - timedelta(days=10-i) if i < 10 else datetime.utcnow() + timedelta(days=i)
        r = Reserva(
            user_id=usuarios[i % 5].id, 
            fecha_reserva=fecha, 
            cantidad_personas=2,
            estado_pago=EstadoPagoEnum.PAGADO
        )
        reservas.append(r)
    
    db.add_all(reservas)
    db.commit()
    print("Seeding de base de datos finalizado con éxito.")

    # 5. Generar carpeta y QRs para las reservas creadas
    output_dir = "qrs_generados"
    os.makedirs(output_dir, exist_ok=True)
    print(f"\nGenerando QRs en la carpeta '{output_dir}'...")

    # Seleccionamos 5 reservas (por ejemplo, las últimas 5 que son futuras)
    reservas_guardadas = db.query(Reserva).limit(5).all()

    if not settings.jwt_private_key:
        print("❌ ERROR: No se encontró JWT_PRIVATE_KEY en las variables de entorno. No se pudieron generar los QRs.")
        db.close()
        return

    service = SecurityService(private_key=settings.jwt_private_key)
    fecha_actual = int(time.time())

    for index, reserva in enumerate(reservas_guardadas, start=1):
        datos_reserva = {
            "jti": str(uuid.uuid4()), 
            "reserva_id": str(reserva.id), # UUID real obtenido de la BD
            "camping_id": "CAMP-01", 
            "iat": fecha_actual,
            "cantidad_personas": reserva.cantidad_personas,
            "typ": "visitante",
            "exp": fecha_actual + (60 * 60 * 24), # Expira en 24 horas
            "dat": reserva.fecha_reserva.strftime("%Y-%m-%d") 
        }
        
        try:
            # Validamos y generamos el token JWT
            payload = JWTPayloadSchema(**datos_reserva)
            token = service.generate_offline_qr_token(payload)
            
            # Creamos la imagen del QR
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=4,
            )
            qr.add_data(token)
            qr.make(fit=True)
            
            img = qr.make_image(fill_color="black", back_color="white")
            
            # Guardamos la imagen en la carpeta
            nombre_archivo = os.path.join(output_dir, f"qr_reserva_{index}.png")
            img.save(nombre_archivo)
            
            print(f"✅ QR {index} generado para Reserva ID: {reserva.id} -> Guardado en '{nombre_archivo}'")
            
        except Exception as e:
            print(f"❌ ERROR al generar el QR {index}: {e}")

    db.close()
    print("\n🎉 ¡Proceso completo finalizado con éxito!")

if __name__ == "__main__":
    run_seed_con_qrs()