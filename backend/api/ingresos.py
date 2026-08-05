from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

# Importa tu generador de sesiones de DB y modelos
from core.database import get_db
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import Reserva
from security.sync_schemas import SyncIngresosRequest, SyncIngresosResponse


router = APIRouter(prefix="/api/ingresos", tags=["Ingresos"])

# Esto lo dejas exactamente igual
@router.post("/sync", response_model=SyncIngresosResponse, status_code=status.HTTP_200_OK)
def sincronizar_ingresos_offline(
    payload: SyncIngresosRequest, 
    db: Session = Depends(get_db)
):
    """
    Recibe un lote de ingresos procesados offline y los impacta en PostgreSQL.
    Garantiza transacciones seguras e idempotencia.
    """
    sincronizados = []
    errores = []

    for item in payload.ingresos:
        try:
            # 1. Validar si la reserva existe en la BD
            reserva = db.query(Reserva).filter(Reserva.id == item.reserva_id).first()
            if not reserva:
                errores.append(f"JTI {item.jti}: Reserva {item.reserva_id} no encontrada en el sistema.")
                continue

            # 2. Idempotencia: ¿Ya sincronizamos este ingreso antes?
            ingreso_previo = db.query(IngresoFisico).filter(
                IngresoFisico.reserva_id == item.reserva_id
            ).first()

            if ingreso_previo:
                # Si ya existe, simplemente le decimos al Frontend que es un éxito 
                # para que lo elimine de su memoria IndexedDB y no vuelva a insistir.
                sincronizados.append(item.jti)
                continue

            # 3. Preparar el nuevo ingreso físico
            nuevo_ingreso = IngresoFisico(
                reserva_id=item.reserva_id,
                fecha_hora_ingreso=item.fecha_escaneo,
                tipo_ingreso=TipoIngresoEnum.WEB, # Es WEB porque proviene de un QR pre-reservado
                sincronizado_offline=True         # Flag de auditoría activada (DoD)
            )
            
            db.add(nuevo_ingreso)
            sincronizados.append(item.jti)

        except Exception as e:
            # Si ocurre un error a nivel de base de datos con este registro particular
            errores.append(f"Error procesando JTI {item.jti}: {str(e)}")

    # 4. Atomicidad: Hacemos un solo commit para todo el lote (Batch insertion)
    # Si falla el commit, nada se guarda y el frontend reintentará luego.
    try:
        if sincronizados:
            db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error crítico al realizar el commit de la sincronización en la base de datos."
        )

    # 5. Retornar qué registros fueron un éxito
    return SyncIngresosResponse(
        sincronizados=sincronizados,
        errores=errores
    )