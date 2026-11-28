import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { formatearMonto } from '@/lib/cotizacion';
import { ErrorApi } from '@/lib/descuentos';
import { formatearFecha } from '@/lib/fechas';
import {
  ETIQUETA_TIPO_CLIENTE,
  etiquetaEstadoPago,
  formatearFechaHora,
  numeroReserva,
  obtenerDetalleReserva,
  type DetalleReserva as Detalle,
} from '@/lib/reservasAdmin';

interface Props {
  /** Reserva a mostrar; null cierra la ventana. */
  reservaId: string | null;
  onCerrar: () => void;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-600">{etiqueta}</dt>
      <dd className="text-sm text-zinc-900">{children}</dd>
    </div>
  );
}

/** Ventana emergente con el detalle de una reserva: datos, personas, pagos y si ya ingresó. */
export default function DetalleReserva({ reservaId, onCerrar }: Props) {
  const { token } = useAuth();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  useEffect(() => {
    if (!reservaId || !token) return;
    const control = new AbortController();
    setDetalle(null);
    setError('');
    obtenerDetalleReserva(token, reservaId, control.signal)
      .then((datos) => {
        if (!control.signal.aborted) setDetalle(datos);
      })
      .catch((e: unknown) => {
        if (control.signal.aborted) return;
        if (e instanceof ErrorApi) {
          if (e.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
          setError(e.message);
        } else {
          setError('Ocurrió un error inesperado. Intentá de nuevo.');
        }
      });
    return () => control.abort();
  }, [reservaId, token, intento]);

  return (
    <Dialog open={reservaId !== null} onOpenChange={(abierta) => !abierta && onCerrar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {reservaId ? `Reserva ${numeroReserva(reservaId)}` : 'Reserva'}
          </DialogTitle>
          <DialogDescription>{detalle ? detalle.titular : 'Detalle de la reserva'}</DialogDescription>
        </DialogHeader>

        {!detalle && !error && (
          <p role="status" className="text-sm text-zinc-600">
            Cargando detalle…
          </p>
        )}

        {error && (
          <div className="space-y-3">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
            <Button variant="outline" size="sm" onClick={reintentar}>
              Reintentar
            </Button>
          </div>
        )}

        {detalle && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Dato etiqueta="Tipo de reserva">{detalle.tipo_reserva_nombre ?? 'Sin tipo'}</Dato>
              <Dato etiqueta="Tipo de cliente">{ETIQUETA_TIPO_CLIENTE[detalle.tipo_cliente]}</Dato>
              <Dato etiqueta="Estadía">
                {`${formatearFecha(detalle.fecha_ingreso)} al ${formatearFecha(detalle.fecha_egreso)}`}
              </Dato>
              <Dato etiqueta="Personas">{detalle.cantidad_personas}</Dato>
              <Dato etiqueta="Monto">{formatearMonto(detalle.monto_total)}</Dato>
              {(detalle.descuento_total ?? 0) > 0 && (
                <Dato etiqueta="Descuento">
                  -{formatearMonto(detalle.descuento_total ?? 0)}
                  {detalle.descuento_pct ? ` (${detalle.descuento_pct}%)` : ''}
                </Dato>
              )}
              {detalle.dni_titular && <Dato etiqueta="DNI del titular">{detalle.dni_titular}</Dato>}
              <Dato etiqueta="Estado">
                <span className="flex flex-wrap gap-1">
                  <Badge variant="outline">{detalle.estado_reserva}</Badge>
                  <Badge variant="secondary">{`Pago: ${detalle.estado_pago}`}</Badge>
                </span>
              </Dato>
              <Dato etiqueta="Email">{detalle.email}</Dato>
              {detalle.telefono && <Dato etiqueta="Teléfono">{detalle.telefono}</Dato>}
              <Dato etiqueta="Reservada el">{formatearFechaHora(detalle.fecha_reserva)}</Dato>
              <Dato etiqueta="Ingreso">
                {detalle.ya_ingreso && detalle.fecha_primer_ingreso
                  ? `Ingresó el ${formatearFechaHora(detalle.fecha_primer_ingreso)}`
                  : 'Todavía no ingresó'}
              </Dato>
            </dl>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Personas</h3>
              {detalle.personas.length === 0 ? (
                <p className="text-sm text-zinc-600">
                  Esta reserva solo guarda al titular y la cantidad de personas.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  {/* Nombre de la tabla para los lectores de pantalla */}
                  <caption className="sr-only">Personas de la reserva</caption>
                  <thead className="border-b text-zinc-600">
                    <tr>
                      <th scope="col" className="py-1 font-medium">Nombre</th>
                      <th scope="col" className="py-1 font-medium">Edad</th>
                      <th scope="col" className="py-1 font-medium">Condición</th>
                      <th scope="col" className="py-1 font-medium">DNI</th>
                      <th scope="col" className="py-1 text-right font-medium">Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.personas.map((persona, indice) => (
                      <tr key={`${persona.nombre}-${indice}`} className="border-b last:border-b-0">
                        <td className="py-1">{persona.nombre}</td>
                        <td className="py-1">{persona.edad}</td>
                        <td className="py-1">{ETIQUETA_TIPO_CLIENTE[persona.condicion]}</td>
                        <td className="py-1">{persona.dni ?? '—'}</td>
                        <td className="py-1 text-right">{formatearMonto(persona.precio_final)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Pagos</h3>
              {detalle.pagos.length === 0 ? (
                <p className="text-sm text-zinc-600">No hay pagos registrados.</p>
              ) : (
                <ul className="space-y-2">
                  {detalle.pagos.map((pago) => (
                    <li key={pago.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{etiquetaEstadoPago(pago.estado)}</span>
                        <span>{pago.monto !== null ? formatearMonto(pago.monto) : '—'}</span>
                      </div>
                      <div className="text-xs text-zinc-600">
                        {`Mercado Pago ${pago.mp_payment_id} · ${formatearFechaHora(
                          pago.fecha_aprobacion ?? pago.fecha_creacion
                        )}`}
                      </div>
                      {pago.monto_devuelto !== null && (
                        <div className="text-xs text-zinc-700">
                          {pago.devolucion_estado === 'pendiente_revision'
                            ? `Devolución de ${formatearMonto(pago.monto_devuelto)} pendiente de revisión`
                            : `Se devolvieron ${formatearMonto(pago.monto_devuelto)}`}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
