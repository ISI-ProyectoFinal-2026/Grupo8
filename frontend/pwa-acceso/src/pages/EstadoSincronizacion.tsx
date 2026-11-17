import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogIn,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tokenVencido, useAuth } from '@/context/AuthContext';
import { useConexion } from '@/hooks/useConexion';
import { cn } from '@/lib/utils';
import { MENSAJE_SESION, syncService } from '@/services/syncService';

const formatoFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

const ID_MOTIVO = 'motivo-sincronizar';

interface Aviso {
  tipo: 'exito' | 'error' | 'progreso';
  texto: string;
}

interface DetalleSyncStatus {
  estado: 'iniciando' | 'reintentando' | 'completado' | 'error';
  detalles?: { cantidad?: number; intento?: number; mensaje?: string };
}

// Traduce el aviso de syncService a lo que se muestra en esta pantalla
function avisoDesdeEvento({
  estado,
  detalles,
}: DetalleSyncStatus): Aviso | null {
  const cantidad = detalles?.cantidad ?? 0;
  const ingresos = `${cantidad} ${cantidad === 1 ? 'ingreso' : 'ingresos'}`;
  if (estado === 'completado')
    return { tipo: 'exito', texto: `Listo: se enviaron ${ingresos}.` };
  if (estado === 'reintentando') {
    return {
      tipo: 'progreso',
      texto: `No hubo respuesta del servidor. Reintento ${detalles?.intento ?? ''}…`,
    };
  }
  if (estado === 'error')
    return {
      tipo: 'error',
      texto: detalles?.mensaje ?? 'No se pudo sincronizar.',
    };
  return null;
}

const ESTILO_AVISO: Record<
  Aviso['tipo'],
  { clase: string; Icono: typeof CheckCircle2 }
> = {
  exito: {
    clase: 'border-bosque-200 bg-bosque-50 text-bosque-800',
    Icono: CheckCircle2,
  },
  error: {
    clase: 'border-red-200 bg-red-50 text-red-800',
    Icono: AlertTriangle,
  },
  progreso: {
    clase: 'border-amber-300 bg-amber-50 text-amber-900',
    Icono: Loader2,
  },
};

function Dato({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <dt className="text-sm font-medium text-muted-foreground">{titulo}</dt>
      <dd className="text-right font-semibold text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Estado de sincronización de la app del guardia (/acceso/sincronizacion): conexión, última
 * sincronización correcta, ingresos pendientes y el botón para enviarlos en el momento.
 * Los datos salen de IndexedDB con useLiveQuery, así se actualizan solos cuando termina un envío,
 * lo haya pedido el guardia o lo haya disparado la vuelta de la red.
 */
export default function EstadoSincronizacion() {
  const { token, cerrarSesion } = useAuth();
  const { enLinea, pendientes, sincronizando } = useConexion();
  // undefined mientras se lee; null si nunca se sincronizó (o IndexedDB no respondió)
  const ultima = useLiveQuery(
    () => syncService.obtenerUltimaSincronizacion().catch(() => null),
    []
  );
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  // Sin red el guardia conserva la sesión aunque el token haya vencido; el servidor lo rechazaría igual
  const sesionVencida = tokenVencido(token);
  const ocupado = enviando || sincronizando;

  useEffect(() => {
    const alCambiarSync = (evento: Event) => {
      const detalle = (evento as CustomEvent<DetalleSyncStatus>).detail;
      if (!detalle) return;
      const nuevo = avisoDesdeEvento(detalle);
      if (nuevo) setAviso(nuevo);
    };
    window.addEventListener('sync-status', alCambiarSync);
    return () => window.removeEventListener('sync-status', alCambiarSync);
  }, []);

  // Motivo por el que no se puede sincronizar; null si el botón está disponible
  let motivo: string | null = null;
  if (!enLinea)
    motivo =
      'Sin conexión. Los ingresos se van a enviar solos cuando vuelva Internet.';
  else if (pendientes === null)
    motivo = 'No se pudo leer la cola de este dispositivo.';
  else if (pendientes === 0) motivo = 'No hay ingresos pendientes para enviar.';

  const deshabilitado = motivo !== null || ocupado || pendientes === undefined;

  const sincronizar = async () => {
    if (deshabilitado) return;
    setAviso(null);
    setEnviando(true);
    try {
      await syncService.sincronizarIngresosPendientes();
    } finally {
      setEnviando(false);
    }
  };

  const estiloAviso = aviso ? ESTILO_AVISO[aviso.tipo] : null;

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <h1 className="text-center text-2xl font-semibold text-foreground">
        Estado de sincronización
      </h1>

      <dl className="divide-y divide-tierra-200/70 rounded-3xl border border-tierra-200/70 bg-white shadow-sm">
        <Dato titulo="Conexión">
          {/* Texto e ícono, no solo color. La barra superior ya anuncia los cambios */}
          <span className="inline-flex items-center gap-2">
            {enLinea ? (
              <Wifi className="h-4 w-4 text-bosque-700" aria-hidden="true" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-700" aria-hidden="true" />
            )}
            {enLinea ? 'Online' : 'Offline'}
          </span>
        </Dato>
        <Dato titulo="Última sincronización">
          {ultima === undefined ? (
            '…'
          ) : ultima === null ? (
            <span className="font-normal text-muted-foreground">
              Todavía no hubo una en este dispositivo
            </span>
          ) : (
            <time dateTime={ultima.toISOString()}>
              {formatoFecha.format(ultima)}
            </time>
          )}
        </Dato>
        <Dato titulo="Ingresos pendientes">
          {pendientes === undefined
            ? '…'
            : pendientes === null
              ? 'No disponible'
              : pendientes}
        </Dato>
      </dl>

      {/* Siempre en el DOM: así el lector de pantalla anuncia el resultado cuando aparece */}
      <div role="status">
        {aviso && estiloAviso && (
          <p
            className={cn(
              'flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-center font-semibold',
              estiloAviso.clase
            )}
          >
            <estiloAviso.Icono
              className={cn(
                'h-5 w-5 shrink-0',
                aviso.tipo === 'progreso' && 'motion-safe:animate-spin'
              )}
              aria-hidden="true"
            />
            {aviso.texto}
          </p>
        )}
      </div>

      {sesionVencida ? (
        <section
          role="alert"
          className="space-y-4 rounded-3xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900"
        >
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            {MENSAJE_SESION}
          </p>
          <Button
            onClick={() => enLinea && cerrarSesion()}
            aria-disabled={!enLinea}
            aria-describedby={enLinea ? undefined : ID_MOTIVO}
            className="h-14 w-full text-base font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            <LogIn className="!size-5" aria-hidden="true" />
            Iniciar sesión de nuevo
          </Button>
          {!enLinea && (
            <p id={ID_MOTIVO} className="text-sm">
              Sin conexión no se puede iniciar sesión. Podés seguir registrando
              ingresos.
            </p>
          )}
        </section>
      ) : (
        <div className="space-y-2">
          {/* aria-disabled en vez de disabled: el botón sigue siendo enfocable y el lector lee el motivo */}
          <Button
            onClick={sincronizar}
            aria-disabled={deshabilitado}
            aria-describedby={motivo ? ID_MOTIVO : undefined}
            className="h-16 w-full text-lg font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {ocupado ? (
              <Loader2
                className="!size-6 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw className="!size-6" aria-hidden="true" />
            )}
            {ocupado ? 'Sincronizando…' : 'Sincronizar ahora'}
          </Button>
          {motivo && (
            <p
              id={ID_MOTIVO}
              className="text-center text-sm text-muted-foreground"
            >
              {motivo}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
