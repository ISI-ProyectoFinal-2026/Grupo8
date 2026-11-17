import { useEffect } from 'react';
import { RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { LogoQamp } from '@/components/marca/LogoQamp';
import { useAuth } from '@/context/AuthContext';
import { useConexion } from '@/hooks/useConexion';
import { cn } from '@/lib/utils';
import { syncService } from '@/services/syncService';
import { BarraNavegacionInferior, SECCIONES_ACCESO } from './BarraNavegacionInferior';

/** Texto del contador. Vacío mientras se hace la primera lectura de IndexedDB. */
function textoPendientes(pendientes: number | null | undefined, sincronizando: boolean): string {
  if (pendientes === undefined) return '';
  if (pendientes === null) return 'Estado de sincronización no disponible';
  if (pendientes === 0) return 'Todo sincronizado';
  const ingresos = `${pendientes} ${pendientes === 1 ? 'ingreso pendiente' : 'ingresos pendientes'}`;
  return sincronizando ? `Sincronizando ${ingresos}…` : ingresos;
}

/**
 * Marco de la PWA de control de acceso. Es independiente de la web de reservas y del
 * panel de administración: barra superior en el verde oscuro del panel, con la conexión y
 * los pendientes, y barra inferior con las cinco opciones del documento (26.4).
 */
export function LayoutAcceso() {
  const { cerrarSesion } = useAuth();
  const { pathname } = useLocation();
  const { enLinea, pendientes, sincronizando } = useConexion();

  // La sincronización automática vive en el marco y no en una pantalla: así sigue andando
  // aunque el guardia esté en Historial o en Registro manual cuando vuelve la red
  useEffect(() => {
    syncService.iniciarBackgroundSync();
  }, []);

  const titulo = SECCIONES_ACCESO.find((s) => s.ruta === pathname)?.titulo ?? 'Escáner';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-lateral text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-4">
          <div className="flex items-center gap-2">
            <LogoQamp tamanio={24} conNombre={false} />
            <span className="text-lg font-semibold">{titulo}</span>
          </div>
          {/* Texto e ícono, no solo color */}
          <span
            role="status"
            className={cn(
              'ml-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold',
              enLinea ? 'bg-white text-bosque-700' : 'bg-amber-100 text-amber-900'
            )}
          >
            {enLinea ? <Wifi className="h-4 w-4" aria-hidden="true" /> : <WifiOff className="h-4 w-4" aria-hidden="true" />}
            {enLinea ? 'Online' : 'Offline'}
          </span>
        </div>
        {/* Región aparte: cada escaneo anuncia solo el contador, sin repetir "Online" */}
        <p
          role="status"
          className="mx-auto flex min-h-8 max-w-3xl items-center gap-2 px-4 pb-2 text-sm text-white/90"
        >
          <RefreshCw
            className={cn('h-4 w-4 shrink-0', sincronizando && 'motion-safe:animate-spin')}
            aria-hidden="true"
          />
          {textoPendientes(pendientes, sincronizando)}
        </p>
      </header>

      <main className="relative flex-1 pb-28">
        <div className="fondo-montanas" aria-hidden="true" />
        <div className="relative">
          <Outlet />
        </div>
      </main>

      <BarraNavegacionInferior onCerrarSesion={cerrarSesion} />
    </div>
  );
}
