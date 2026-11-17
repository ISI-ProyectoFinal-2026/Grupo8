import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useAlertas } from '@/hooks/useAlertas';
import { cn } from '@/lib/utils';

interface CajaBannerProps {
  rol: 'status' | 'alert';
  icono: LucideIcon;
  clase: string;
  girar?: boolean;
  children: ReactNode;
  accion?: ReactNode;
}

/**
 * Misma caja para los cuatro estados, con un alto mínimo que entra el estado más largo
 * (incidentes: título y una línea). Así, cuando llega la respuesta, el banner cambia de
 * contenido pero no de tamaño, y el monitor de ocupación que está debajo no se mueve (CLS).
 */
function CajaBanner({
  rol,
  icono: Icono,
  clase,
  girar,
  children,
  accion,
}: CajaBannerProps) {
  return (
    <div
      role={rol}
      className={cn(
        'flex min-h-[4.5rem] flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3',
        clase
      )}
    >
      <Icono
        className={cn('h-5 w-5 shrink-0', girar && 'motion-safe:animate-spin')}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 text-sm">{children}</div>
      {accion}
    </div>
  );
}

export function BannerAlertas() {
  const { alertas, estado, error } = useAlertas();

  if (estado === 'cargando') {
    return (
      <CajaBanner
        rol="status"
        icono={Loader2}
        girar
        clase="border-zinc-200 bg-white text-zinc-600"
      >
        Revisando alertas de acceso…
      </CajaBanner>
    );
  }
  if (estado === 'error') {
    return (
      <CajaBanner
        rol="status"
        icono={AlertTriangle}
        clase="border-zinc-200 bg-zinc-50 text-zinc-700"
      >
        {`No se pudieron consultar las alertas de acceso. ${error ?? ''}`}
      </CajaBanner>
    );
  }
  if (estado === 'vacio') {
    return (
      <CajaBanner
        rol="status"
        icono={CheckCircle2}
        clase="border-green-200 bg-green-50 text-green-800"
      >
        Sin incidentes de acceso pendientes.
      </CajaBanner>
    );
  }

  const cantidad = alertas.length;
  return (
    <CajaBanner
      rol="alert"
      icono={ShieldAlert}
      clase="border-amber-300 bg-amber-50 text-amber-900"
      accion={
        <Link
          to="/admin/alertas"
          className="rounded-md bg-amber-900 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-900 focus-visible:ring-offset-2"
        >
          Ver alertas
        </Link>
      }
    >
      <p className="font-semibold">{`${cantidad} incidente${cantidad === 1 ? '' : 's'} de acceso sin resolver`}</p>
      <p className="truncate">
        {`Intento de múltiple ingreso detectado para el titular ${alertas[0].titular}`}
        {cantidad > 1 ? ` y ${cantidad - 1} más.` : ''}
      </p>
    </CajaBanner>
  );
}
