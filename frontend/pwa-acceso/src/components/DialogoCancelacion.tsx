import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatearMonto } from '@/lib/cotizacion';
import { formatearFecha } from '@/lib/fechas';
import {
  cancelarReserva,
  obtenerCondicionesCancelacion,
  type CondicionesCancelacion,
  type ReservaDetalle,
  type ResultadoCancelacion,
} from '@/lib/misReservas';

interface Props {
  /** Reserva a cancelar; con null el diálogo está cerrado. */
  reserva: ReservaDetalle | null;
  token: string;
  onCerrar: () => void;
  onCancelada: (resultado: ResultadoCancelacion) => void;
}

function textoDelPlazo(dias: number): string {
  if (dias === 0) return 'hasta el mismo día del ingreso';
  return `${dias} ${dias === 1 ? 'día' : 'días'} antes del ingreso`;
}

function mensajeDeError(error: unknown, porDefecto: string): string {
  return error instanceof Error && error.message ? error.message : porDefecto;
}

/**
 * Diálogo de "Cancelar" en Mis reservas: muestra las condiciones de cancelación que calcula
 * el backend y, si la reserva está dentro del plazo, permite confirmar la cancelación.
 */
export default function DialogoCancelacion({
  reserva,
  token,
  onCerrar,
  onCancelada,
}: Props) {
  const [condiciones, setCondiciones] = useState<CondicionesCancelacion | null>(
    null
  );
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmacion, setErrorConfirmacion] = useState<string | null>(
    null
  );

  const reservaId = reserva?.id ?? null;

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      if (!reservaId) return;
      setCargando(true);
      setErrorCarga(null);
      setCondiciones(null);
      try {
        setCondiciones(
          await obtenerCondicionesCancelacion(token, reservaId, signal)
        );
      } catch (e) {
        if (signal?.aborted) return;
        setErrorCarga(
          mensajeDeError(
            e,
            'No pudimos consultar las condiciones de cancelación. Intentá nuevamente.'
          )
        );
      } finally {
        if (!signal?.aborted) setCargando(false);
      }
    },
    [token, reservaId]
  );

  // Cada vez que se abre para una reserva se piden sus condiciones de nuevo
  useEffect(() => {
    setErrorConfirmacion(null);
    setConfirmando(false);
    if (!reservaId) return;
    const controlador = new AbortController();
    void cargar(controlador.signal);
    return () => controlador.abort();
  }, [reservaId, cargar]);

  const confirmar = async () => {
    if (!reservaId) return;
    setConfirmando(true);
    setErrorConfirmacion(null);
    try {
      onCancelada(await cancelarReserva(token, reservaId));
    } catch (e) {
      setErrorConfirmacion(
        mensajeDeError(e, 'No pudimos cancelar la reserva. Intentá nuevamente.')
      );
    } finally {
      setConfirmando(false);
    }
  };

  const cambiarApertura = (abierto: boolean) => {
    // Mientras se cancela no se cierra, así no queda sin ver el resultado
    if (!abierto && !confirmando) onCerrar();
  };

  const sePuedeConfirmar =
    condiciones?.puede_cancelar === true && !errorConfirmacion;

  return (
    <Dialog open={reserva !== null} onOpenChange={cambiarApertura}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar reserva</DialogTitle>
          <DialogDescription>
            {reserva
              ? `Ingreso el ${formatearFecha(reserva.fecha_ingreso)} · ${formatearMonto(reserva.monto_total)}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {cargando && (
          <p role="status" className="text-sm text-zinc-600">
            Cargando condiciones…
          </p>
        )}

        {errorCarga && (
          <p role="alert" className="text-sm text-red-600">
            {errorCarga}
          </p>
        )}

        {condiciones && !condiciones.puede_cancelar && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {condiciones.mensaje}
          </p>
        )}

        {/* Si la confirmación falló (por ejemplo, venció el plazo) solo queda el motivo y "Volver" */}
        {sePuedeConfirmar && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-zinc-500">Podés cancelar hasta</dt>
              <dd className="font-medium text-zinc-900">
                {formatearFecha(condiciones.fecha_limite)} (
                {textoDelPlazo(condiciones.dias_minimos)})
              </dd>
              <dt className="text-zinc-500">Devolución</dt>
              <dd className="font-medium text-zinc-900">
                {condiciones.porcentaje_devolucion} % de lo que pagaste
              </dd>
              <dt className="text-zinc-500">Monto a devolver</dt>
              <dd className="font-medium text-zinc-900">
                {formatearMonto(condiciones.monto_devolucion)}
              </dd>
            </dl>
            <p className="font-medium text-zinc-900">
              ¿Está seguro que desea cancelar?
            </p>
          </div>
        )}

        {errorConfirmacion && (
          <p role="alert" className="text-sm text-red-600">
            {errorConfirmacion}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={confirmando}>
            Volver
          </Button>
          {errorCarga && (
            <Button variant="outline" onClick={() => void cargar()}>
              Reintentar
            </Button>
          )}
          {sePuedeConfirmar && (
            <Button
              variant="destructive"
              onClick={() => void confirmar()}
              disabled={confirmando}
            >
              {confirmando ? 'Cancelando…' : 'Confirmar cancelación'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
