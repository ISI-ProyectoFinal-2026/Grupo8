import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Clock, History } from 'lucide-react';
import type { HistorialIngreso } from '@/db/db';
import { numeroReserva } from '@/lib/reservasAdmin';
import { cn } from '@/lib/utils';
import { dbService, MAX_HISTORIAL } from '@/services/dbService';

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

const ESTADOS = {
  pendiente: {
    texto: 'Pendiente',
    Icono: Clock,
    clase: 'bg-amber-100 text-amber-900',
  },
  sincronizado: {
    texto: 'Sincronizado',
    Icono: CheckCircle2,
    clase: 'bg-bosque-50 text-bosque-800',
  },
} as const;

function FilaHistorial({ ingreso }: { ingreso: HistorialIngreso }) {
  const estado = ESTADOS[ingreso.estado] ?? ESTADOS.pendiente;
  const titulo =
    ingreso.tipo === 'MANUAL' || !ingreso.reserva_id
      ? 'Ingreso manual'
      : `Reserva ${numeroReserva(ingreso.reserva_id)}`;
  const personas = `${ingreso.cantidad_personas} ${ingreso.cantidad_personas === 1 ? 'persona' : 'personas'}`;

  return (
    <li className="flex items-start justify-between gap-3 rounded-3xl border border-tierra-200/70 bg-white px-5 py-4 shadow-sm">
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{titulo}</p>
        <p className="text-sm text-muted-foreground">
          <time dateTime={ingreso.fecha_ingreso.toISOString()}>
            {formatoFecha.format(ingreso.fecha_ingreso)}
          </time>
          {' · '}
          {personas}
        </p>
      </div>
      {/* Texto e ícono, no solo color */}
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
          estado.clase
        )}
      >
        <estado.Icono className="h-4 w-4" aria-hidden="true" />
        {estado.texto}
      </span>
    </li>
  );
}

/**
 * Historial de la app del guardia (/acceso/historial): los últimos ingresos aceptados en este
 * dispositivo y si ya llegaron al servidor. Se actualiza solo cuando cambia la tabla `historial`,
 * por ejemplo al terminar una sincronización. El historial de todos los dispositivos está en el panel.
 */
export default function HistorialAcceso() {
  // undefined mientras se lee; null si IndexedDB no respondió
  const ingresos = useLiveQuery(
    () => dbService.obtenerHistorial().catch(() => null),
    []
  );

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Historial</h1>
        <p className="text-sm text-muted-foreground">
          Últimos {MAX_HISTORIAL} ingresos registrados en este dispositivo
        </p>
      </div>

      {ingresos === undefined && (
        <p role="status" className="text-center text-muted-foreground">
          Cargando historial…
        </p>
      )}

      {ingresos === null && (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-center text-red-800"
        >
          No se pudo leer el historial de este dispositivo.
        </p>
      )}

      {ingresos?.length === 0 && (
        <section
          aria-labelledby="historial-vacio"
          className="flex flex-col items-center gap-3 rounded-3xl border border-tierra-200/70 bg-white px-6 py-10 text-center shadow-sm"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-tierra-800">
            <History className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2
            id="historial-vacio"
            className="text-lg font-semibold text-foreground"
          >
            Todavía no hay ingresos
          </h2>
          <p className="max-w-sm text-base text-muted-foreground">
            Cuando registres un ingreso con QR o manual, va a aparecer acá con
            su estado de sincronización.
          </p>
        </section>
      )}

      {ingresos && ingresos.length > 0 && (
        <ol aria-label="Últimos ingresos" className="space-y-3">
          {ingresos.map((ingreso) => (
            <FilaHistorial key={ingreso.id ?? ingreso.jti} ingreso={ingreso} />
          ))}
        </ol>
      )}
    </div>
  );
}
