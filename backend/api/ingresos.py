import logging
from typing import Literal, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from uuid import UUID

from core.database import get_db
from core.dependencies import require_role
from core.tiempo import dia_negocio
from models.conflictos import ConflictosSincronizacion
from models.ingreso_fisico import IngresoFisico, TipoIngresoEnum
from models.reserva import Reserva
from models.user import RoleEnum
from security.sync_schemas import (
    ErrorIngreso,
    IngresoManualItem,
    IngresoQRItem,
    SyncIngresosRequest,
    SyncIngresosResponse,
    ingreso_item_adapter,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ingresos", tags=["Ingresos y Sincronización"])

# Cómo se guarda en la BD cada tipo que viaja en el lote
_TIPO_EN_BD = {"QR": TipoIngresoEnum.WEB, "MANUAL": TipoIngresoEnum.ESPONTANEO}

ItemIngreso = Union[IngresoQRItem, IngresoManualItem]
# procesado: ingreso nuevo | reintento: mismo jti y mismo dispositivo | conflicto: QR clonado o duplicado
ResultadoItem = Literal["procesado", "reintento", "conflicto"]


class IngresoInvalidoError(Exception):
    """El ítem tiene buen formato pero no se puede registrar (ej: reserva inexistente)."""


def _jti_seguro(crudo: object) -> Optional[str]:
    if isinstance(crudo, dict) and crudo.get("jti") is not None:
        return str(crudo["jti"])
    return None


def _resumir_validacion(exc: ValidationError) -> str:
    detalles = exc.errors(include_url=False, include_input=False, include_context=False)
    return "; ".join(f"{'.'.join(str(p) for p in d['loc'])}: {d['msg']}" for d in detalles)


def _buscar_por_jti(db: Session, jti: str) -> Optional[IngresoFisico]:
    return db.query(IngresoFisico).filter(IngresoFisico.jti == jti).first()


def _validar_vigencia_qr(reserva: Reserva, item: ItemIngreso) -> None:
    """
    Rechaza el ingreso de una reserva si se hizo fuera de su estadía (28.1). Vale para el QR
    escaneado y para el manual con reserva (29.1), que carga el código del QR a mano.

    Se compara el día de Buenos Aires de `fecha_escaneo` (la hora real del escaneo, no la de
    llegada del lote) con las fechas de la reserva guardada en la base, con los dos extremos
    incluidos. No se usan las fechas del token: la PWA no es de confianza y el lote puede llegar
    horas o días después del escaneo.
    """
    dia_escaneo = dia_negocio(item.fecha_escaneo)
    if reserva.fecha_ingreso <= dia_escaneo <= reserva.fecha_egreso:
        return

    logger.warning(
        "QR fuera de fecha: jti=%s reserva=%s dispositivo=%s escaneado el %s (estadía %s a %s)",
        item.jti, reserva.id, item.dispositivo_id, dia_escaneo, reserva.fecha_ingreso, reserva.fecha_egreso,
    )
    raise IngresoInvalidoError(
        f"QR fuera de fecha: se escaneó el {dia_escaneo.isoformat()} y la reserva es del "
        f"{reserva.fecha_ingreso.isoformat()} al {reserva.fecha_egreso.isoformat()}."
    )


def _registrar_clonacion(db: Session, item: ItemIngreso, reserva_id: UUID) -> None:
    """Guarda el intento rechazado y pone la reserva en alerta."""
    # Se bloquea la reserva para que dos clones detectados a la vez no se pisen
    reserva = db.query(Reserva).filter(Reserva.id == reserva_id).with_for_update().first()
    if reserva is None:
        raise IngresoInvalidoError(f"Reserva {reserva_id} no encontrada en el sistema.")

    db.add(ConflictosSincronizacion(
        reserva_id=reserva_id,
        jti_involucrado=item.jti,
        dispositivo_id=item.dispositivo_id,
        motivo="QR clonado: mismo jti desde otro dispositivo",
        fecha_registro=item.fecha_escaneo,
    ))
    reserva.marcar_alerta_clonacion()
    db.flush()


def _resolver_jti_existente(db: Session, item: ItemIngreso, existente: IngresoFisico) -> ResultadoItem:
    # Si el ingreso guardado no tiene dispositivo (es anterior a esta versión) no se puede
    # asegurar que sea un clon, así que se trata como reintento para no acusar a un visitante honesto
    if existente.dispositivo_id is None or existente.dispositivo_id == item.dispositivo_id:
        return "reintento"

    reserva_id = existente.reserva_id or item.reserva_id
    if reserva_id is None:
        raise IngresoInvalidoError("El jti ya fue registrado por otro dispositivo y no tiene reserva asociada.")

    _registrar_clonacion(db, item, reserva_id)
    return "conflicto"


def _procesar_item(db: Session, item: ItemIngreso) -> ResultadoItem:
    # 1. ¿Ese jti ya está registrado? Es el caso de reintento o de QR clonado
    existente = _buscar_por_jti(db, item.jti)
    if existente is not None:
        return _resolver_jti_existente(db, item, existente)

    # 2. jti nuevo: se valida la reserva y se mantiene la resolución de conflictos de la 7.5
    if item.reserva_id is not None:
        reserva = db.query(Reserva).filter(Reserva.id == item.reserva_id).first()
        if reserva is None:
            raise IngresoInvalidoError(f"Reserva {item.reserva_id} no encontrada en el sistema.")

        # Antes de buscar duplicados: un ingreso fuera de fecha se rechaza por eso y no como "duplicado"
        _validar_vigencia_qr(reserva, item)

        ingreso_previo = db.query(IngresoFisico).filter(
            IngresoFisico.reserva_id == item.reserva_id
        ).first()
        if ingreso_previo is not None:
            # Carrera: el ingreso con este mismo jti se confirmó justo después de mi primera consulta
            if ingreso_previo.jti == item.jti:
                return _resolver_jti_existente(db, item, ingreso_previo)

            db.add(ConflictosSincronizacion(
                reserva_id=item.reserva_id,
                jti_involucrado=item.jti,
                dispositivo_id=item.dispositivo_id,
                motivo="Conflicto por Duplicado",
                fecha_registro=item.fecha_escaneo,
            ))
            db.flush()
            return "conflicto"

    # 3. Inserción normal
    nuevo = IngresoFisico(
        jti=item.jti,
        dispositivo_id=item.dispositivo_id,
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


def _guardar_item(db: Session, item: ItemIngreso) -> ResultadoItem:
    """Guarda un ítem en su propio savepoint: si falla, solo se deshace ese."""
    try:
        with db.begin_nested():
            return _procesar_item(db, item)
    except IntegrityError:
        # Carrera: otro lote guardó este jti entre mi consulta y mi INSERT. La BD ya frenó
        # el duplicado; ahora se clasifica el intento contra el ingreso que ganó.
        with db.begin_nested():
            existente = _buscar_por_jti(db, item.jti)
            if existente is None:
                raise  # fue otra restricción, no la del jti
            return _resolver_jti_existente(db, item, existente)


@router.post(
    "/bulk-sync",
    response_model=SyncIngresosResponse,
    status_code=status.HTTP_200_OK,
    # Solo el guardia sincroniza ingresos: sin token es 401 y con otro rol, 403
    dependencies=[Depends(require_role(RoleEnum.SEGURIDAD))],
)
def sincronizacion_masiva_offline(
    payload: SyncIngresosRequest,
    db: Session = Depends(get_db),
) -> SyncIngresosResponse:
    """
    Sincroniza un lote de ingresos con éxito parcial: cada ítem se valida y se guarda por separado,
    uno inválido no frena al resto y se hace un solo commit al final.
    """
    sincronizados_jti: List[str] = []
    errores: List[ErrorIngreso] = []
    procesados = 0
    conflictos = 0

    for indice, crudo in enumerate(payload.ingresos):
        try:
            item = ingreso_item_adapter.validate_python(crudo)
        except ValidationError as exc:
            errores.append(ErrorIngreso(
                indice=indice, jti=_jti_seguro(crudo), motivo=_resumir_validacion(exc)
            ))
            continue

        try:
            resultado = _guardar_item(db, item)
        except IngresoInvalidoError as exc:
            errores.append(ErrorIngreso(indice=indice, jti=item.jti, motivo=str(exc)))
            continue
        except Exception:
            # El detalle va al log, no a la respuesta
            logger.exception("Error procesando el ingreso %s del lote", item.jti)
            errores.append(ErrorIngreso(
                indice=indice, jti=item.jti, motivo="Error interno al procesar el ingreso."
            ))
            continue

        sincronizados_jti.append(item.jti)
        if resultado == "procesado":
            procesados += 1
        elif resultado == "conflicto":
            conflictos += 1

    try:
        if sincronizados_jti:
            db.commit()
    except Exception:
        db.rollback()
        logger.exception("Falló el commit del lote de ingresos")
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