from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from core.database import get_db
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import Reserva
from security.sync_schemas import SyncIngresosRequest

# TODO (Base de Datos): Asegurarse de que este modelo exista con estos campos
from models.conflictos import ConflictosSincronizacion 

# Ajustamos el prefijo para cumplir con la arquitectura v1
router = APIRouter(prefix="/api/v1/ingresos", tags=["Ingresos y Sincronización"])

@router.post("/bulk-sync", status_code=status.HTTP_200_OK)
def sincronizacion_masiva_offline(
    payload: SyncIngresosRequest, 
    db: Session = Depends(get_db)
):
    """
    Endpoint POST /api/v1/ingresos/bulk-sync
    Procesa lotes de ingresos, garantizando atomicidad y auditando conflictos de concurrencia.
    """
    sincronizados_jti = []
    errores = []
    procesados_count = 0
    conflictos_count = 0

    for item in payload.ingresos:
        try:
            # 1. Validar si la reserva existe en la BD central
            reserva = db.query(Reserva).filter(Reserva.id == item.reserva_id).first()
            if not reserva:
                errores.append(f"Reserva {item.reserva_id} no encontrada en el sistema.")
                continue

            # 2. Resolución de Conflictos (DoD 7.5)
            ingreso_previo = db.query(IngresoFisico).filter(
                IngresoFisico.reserva_id == item.reserva_id
            ).first()

            if ingreso_previo:
                # El QR ya fue escaneado por otro guardia. Lo mandamos a la tabla de auditoría.
                nuevo_conflicto = ConflictosSincronizacion(
                    reserva_id=item.reserva_id,
                    jti_involucrado=item.jti,
                    motivo="Conflicto por Duplicado",
                    fecha_registro=item.fecha_escaneo
                )
                db.add(nuevo_conflicto)
                conflictos_count += 1
                
                # Lo agregamos a sincronizados para que la PWA lo borre de su cola pendiente
                sincronizados_jti.append(item.jti)
                continue

            # 3. Inserción normal (No hay conflicto)
            nuevo_ingreso = IngresoFisico(
                reserva_id=item.reserva_id,
                fecha_hora_ingreso=item.fecha_escaneo,
                tipo_ingreso=TipoIngresoEnum.WEB, 
                sincronizado_offline=True
            )
            db.add(nuevo_ingreso)
            
            procesados_count += 1
            sincronizados_jti.append(item.jti)

        except Exception as e:
            # Aislamos el error para que un registro corrupto no frene todo el lote
            errores.append(f"Error procesando JTI {item.jti}: {str(e)}")

    # 4. Atomicidad: Hacemos un solo commit para todo el lote
    try:
        if sincronizados_jti:
            db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error crítico al realizar el commit del lote en PostgreSQL."
        )

    # 5. Retornar estadísticas exactas solicitadas en el DoD
    return {
        "procesados": procesados_count,
        "conflictos": conflictos_count,
        "sincronizados_jti": sincronizados_jti,
        "errores": errores
    }