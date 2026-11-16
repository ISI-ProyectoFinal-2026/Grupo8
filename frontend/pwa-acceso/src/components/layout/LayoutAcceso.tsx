import { useState } from 'react';
import { History, LogOut, Menu, RefreshCw, ScanLine, ShieldCheck, UserPlus, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogoQamp } from '@/components/marca/LogoQamp';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/context/AuthContext';
import { useConexion } from '@/hooks/useConexion';
import { cn } from '@/lib/utils';

interface Seccion {
  ruta: string;
  titulo: string;
  icono: LucideIcon;
}

// Barra inferior, con el escáner al medio. La 26.4 suma Estado de sincronización.
const SECCIONES: Seccion[] = [
  { ruta: '/acceso/historial', titulo: 'Historial', icono: History },
  { ruta: '/acceso', titulo: 'Escáner', icono: ScanLine },
  { ruta: '/acceso/manual', titulo: 'Registro manual', icono: UserPlus },
];

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
 * panel de administración: barra superior en el verde oscuro del panel, con el menú ☰
 * (donde está "Cerrar sesión"), y barra inferior para pasar del escáner al registro manual.
 */
export function LayoutAcceso() {
  const { cerrarSesion } = useAuth();
  const { pathname } = useLocation();
  const { enLinea, pendientes, sincronizando } = useConexion();
  const [menuAbierto, setMenuAbierto] = useState(false);

  const titulo = SECCIONES.find((s) => s.ruta === pathname)?.titulo ?? 'Escáner';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-lateral text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Abrir menú"
            onClick={() => setMenuAbierto(true)}
            className="h-12 w-12 text-white hover:bg-white/10 hover:text-white [&_svg]:size-6"
          >
            <Menu aria-hidden="true" />
          </Button>
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

      <nav
        aria-label="Navegación de la app del guardia"
        className="sticky bottom-0 z-40 border-t border-tierra-200 bg-white px-3 pb-4 pt-2"
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          {SECCIONES.map(({ ruta, titulo: texto, icono: Icono }) => (
            <NavLink
              key={ruta}
              to={ruta}
              end
              className={({ isActive }) =>
                cn(
                  // text-center: en el celular "Registro manual" ocupa dos renglones y tiene que quedar centrado
                  'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center text-sm font-medium leading-tight transition-colors',
                  isActive ? 'bg-secondary font-semibold text-tierra-900' : 'text-tierra-700 hover:bg-tierra-100'
                )
              }
            >
              <Icono className="h-6 w-6" aria-hidden="true" />
              {texto}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Menú lateral: se abre con ☰, se cierra con Esc o tocando afuera */}
      <Dialog open={menuAbierto} onOpenChange={setMenuAbierto}>
        <DialogContent className="left-0 top-0 flex h-full w-[300px] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-6 rounded-none rounded-r-3xl border-0 p-6">
          <DialogTitle className="text-foreground">
            <LogoQamp tamanio={30} />
          </DialogTitle>
          <DialogDescription className="sr-only">Menú de la app de control de acceso</DialogDescription>

          <div className="flex items-center gap-3 rounded-2xl bg-tierra-100 p-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-tierra-800">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">Guardia</p>
              <p className="text-sm text-muted-foreground">Control de acceso</p>
            </div>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
            {pendientes === undefined
              ? 'Contando ingresos pendientes…'
              : textoPendientes(pendientes, sincronizando)}
          </p>

          <Button
            variant="outline"
            onClick={() => {
              setMenuAbierto(false);
              cerrarSesion();
            }}
            className="mt-auto h-14 border-2 border-destructive text-base font-semibold text-destructive hover:bg-red-50 hover:text-destructive"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
            Cerrar sesión
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
