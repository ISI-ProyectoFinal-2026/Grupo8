from core.database import SessionLocal
from models.user import User, RoleEnum
from models.reserva import Reserva, EstadoPagoEnum
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
    print("Seeding finalizado con éxito.")

if __name__ == "__main__":
    run_seed()