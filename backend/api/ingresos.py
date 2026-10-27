from typing import Any, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import get_db
from models.conflictos import ConflictosSincronizacion
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import Reserva
from security.sync_schemas import (
    ErrorIngreso,
    IngresoManualItem,
    IngresoQRItem,
    SyncIngresosRequest,
    SyncIngresosResponse,
    ingreso_item_adapter,
)

router = APIRouter(prefix="/api/v1/ingresos", tags=["Ingresos y Sincronización"])

# Cómo se guarda en la BD cada tipo que viaja en el lote
_TIPO_EN_BD = {"QR": TipoIngresoEnum.WEB, "MANUAL": TipoIngresoEnum.ESPONTANEO}

ResultadoItem = Literal["procesado", "conflicto", "duplicado"]


class IngresoInvalidoError(Exception):
    """El ítem tiene el formato correcto pero no se puede registrar (ej: reserva inexistente)."""


def _jti_seguro(crudo: Any) -> Optional[str]:
    if isinstance(crudo, dict) and crudo.get("jti") is not None:
        return str(crudo["jti"])
    return None


def _resumir_validacion(exc: ValidationError) -> str:
    detalles = exc.errors(include_url=False, include_input=False, include_context=False)
    return "; ".join(f"{'.'.join(str(p) for p in d['loc'])}: {d['msg']}" for d in detalles)


def _existe_jti(db: Session, jti: str) -> bool:
    return db.query(IngresoFisico.id).filter(IngresoFisico.jti == jti).first() is not None


def _procesar_item(
    db: Session, item: Union[IngresoQRItem, IngresoManualItem]
) -> ResultadoItem:
    # Idempotencia del manual: si ese jti ya está guardado, es un reenvío
    if isinstance(item, IngresoManualItem) and _existe_jti(db, item.jti):
        return "duplicado"

    if item.reserva_id is not None:
        reserva = db.query(Reserva).filter(Reserva.id == item.reserva_id).first()
        if not reserva:
            raise IngresoInvalidoError(f"Reserva {item.reserva_id} no encontrada en el sistema.")

        # Resolución de conflictos (DoD 7.5): la reserva ya tenía un ingreso
        ingreso_previo = db.query(IngresoFisico.id).filter(
            IngresoFisico.reserva_id == item.reserva_id
        ).first()
        if ingreso_previo:
            db.add(ConflictosSincronizacion(
                reserva_id=item.reserva_id,
                jti_involucrado=item.jti,
                motivo="Conflicto por Duplicado",
                fecha_registro=item.fecha_escaneo,
            ))
            db.flush()
            return "conflicto"

    nuevo = IngresoFisico(
        jti=item.jti,
        reserva_id=item.reserva_id,
        fecha_hora_ingreso=item.fecha_escaneo,
        tipo_ingreso=_TIPO_EN_BD[item.tipo_ingreso],
        cantidad_personas=item.cantidad_personas,
        sincronizado_offline=True,
    )
    if isinstance(item, IngresoManualItem):
        nuevo.monto_cobrado = item.monto_cobrado
        nuevo.nombre = item.nombre
        nuevo.dni = item.dni
    db.add(nuevo)
    db.flush()  # acá salta el UNIQUE de jti si hay una carrera
    return "procesado"


@router.post(
    "/bulk-sync",
    response_model=SyncIngresosResponse,
    status_code=status.HTTP_200_OK,
)
def sincronizacion_masiva_offline(
    payload: SyncIngresosRequest,
    db: Session = Depends(get_db),
) -> SyncIngresosResponse:
    """
    Procesa un lote de ingresos (QR y manuales) con éxito parcial: cada ítem se valida
    y se guarda por separado, uno inválido no frena al resto, y se hace un solo commit.
    """
    sincronizados_jti: List[str] = []
    errores: List[ErrorIngreso] = []
    procesados = 0
    conflictos = 0

    for indice, crudo in enumerate(payload.ingresos):
        # 1. Validación aislada de este ítem
        try:
            item = ingreso_item_adapter.validate_python(crudo)
        except ValidationError as exc:
            errores.append(ErrorIngreso(
                indice=indice, jti=_jti_seguro(crudo), motivo=_resumir_validacion(exc)
            ))
            continue

        # 2. Guardado aislado: si falla, solo se deshace este ítem
        try:
            with db.begin_nested():
                resultado = _procesar_item(db, item)
        except IngresoInvalidoError as exc:
            errores.append(ErrorIngreso(indice=indice, jti=item.jti, motivo=str(exc)))
            continue
        except IntegrityError:
            # Otra petición guardó el mismo jti justo antes: se trata como reenvío
            if _existe_jti(db, item.jti):
                sincronizados_jti.append(item.jti)
            else:
                errores.append(ErrorIngreso(
                    indice=indice, jti=item.jti, motivo="Error de integridad al guardar."
                ))
            continue
        except Exception as exc:
            errores.append(ErrorIngreso(
                indice=indice, jti=item.jti, motivo=f"Error procesando el ingreso: {exc}"
            ))
            continue

        sincronizados_jti.append(item.jti)
        if resultado == "procesado":
            procesados += 1
        elif resultado == "conflicto":
            conflictos += 1

    # 3. Un solo commit para todo lo que salió bien
    try:
        if sincronizados_jti:
            db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error crítico al realizar el commit del lote en PostgreSQL.",
        )

    return SyncIngresosResponse(
        procesados=procesados,
        conflictos=conflictos,
        sincronizados_jti=sincronizados_jti,
        errores=errores,
    )