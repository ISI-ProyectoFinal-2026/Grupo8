from core.database import SessionLocal
from models.user import User, RoleEnum
from models.reserva import Reserva, EstadoPagoEnum, EstadoReservaEnum
from services.camping_service import obtener_o_crear_camping
from services.pricing_service import PricingService
from datetime import datetime, timedelta

# Creamos la sesión
db = SessionLocal()

def run_seed():
    print("--- Iniciando Seeding ---")
    
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
    # Las reservas necesitan que el camping exista en configuracion_camping
    camping = obtener_o_crear_camping(db)
    reservas = []
    for i in range(15):
        fecha = datetime.utcnow() - timedelta(days=10-i) if i < 10 else datetime.utcnow() + timedelta(days=i)
        usuario = usuarios[i % 5]
        r = Reserva(
            user_id=usuario.id, 
            camping_id=camping.camping_id,
            fecha_ingreso=fecha.date(), 
            fecha_egreso=fecha.date(), 
            cantidad_personas=2,
            monto_total=PricingService.calcular_precio(2, usuario.is_socio),
            titular=usuario.nombre,
            email=usuario.email,
            telefono="2604000000",
            estado_reserva=EstadoReservaEnum.CONFIRMADA,
            estado_pago=EstadoPagoEnum.PAGADO
        )
        reservas.append(r)
    
    db.add_all(reservas)
    db.commit()
    print("Seeding finalizado con éxito.")

if __name__ == "__main__":
    run_seed()