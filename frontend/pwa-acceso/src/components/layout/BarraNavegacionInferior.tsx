import {
  History,
  LogOut,
  RefreshCw,
  ScanLine,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface SeccionAcceso {
  ruta: string;
  /** Texto de la barra. Es también el nombre accesible del enlace. */
  texto: string;
  /** Título que muestra la barra superior en esa pantalla. */
  titulo: string;
  icono: LucideIcon;
}

// Orden del documento, con el escáner al medio para tenerlo a mano con el pulgar
export const SECCIONES_ACCESO: SeccionAcceso[] = [
  {
    ruta: '/acceso/historial',
    texto: 'Historial',
    titulo: 'Historial',
    icono: History,
  },
  {
    ruta: '/acceso/manual',
    texto: 'Registro manual',
    titulo: 'Registro manual',
    icono: UserPlus,
  },
  { ruta: '/acceso', texto: 'Escáner', titulo: 'Escáner', icono: ScanLine },
  {
    ruta: '/acceso/sincronizacion',
    texto: 'Sincronización',
    titulo: 'Sincronización',
    icono: RefreshCw,
  },
];

// Mínimo 56 px de alto y el ancho repartido entre las cinco: más que los 44 px que pide WCAG 2.5.5
const CLASE_OPCION =
  'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-center text-xs font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm';

interface BarraNavegacionInferiorProps {
  onCerrarSesion: () => void;
}

/**
 * Barra inferior de la app del guardia: Historial, Registro manual, Escáner, Sincronización
 * y Cerrar sesión. NavLink marca la pantalla actual con aria-current="page", además del color.
 * "Cerrar sesión" es un botón y no un enlace, porque no lleva a otra pantalla: hace una acción.
 */
export function BarraNavegacionInferior({
  onCerrarSesion,
}: BarraNavegacionInferiorProps) {
  return (
    <nav
      aria-label="Navegación de la app del guardia"
      // El margen de abajo respeta la barra de gestos de los celulares sin botones
      className="sticky bottom-0 z-40 border-t border-tierra-200 bg-white px-2 pt-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        {SECCIONES_ACCESO.map(({ ruta, texto, icono: Icono }) => (
          <li key={ruta} className="flex">
            <NavLink
              to={ruta}
              end
              className={({ isActive }) =>
                cn(
                  CLASE_OPCION,
                  isActive
                    ? 'bg-secondary font-semibold text-tierra-900'
                    : 'text-tierra-700 hover:bg-tierra-100'
                )
              }
            >
              <Icono className="h-6 w-6 shrink-0" aria-hidden="true" />
              {texto}
            </NavLink>
          </li>
        ))}
        <li className="flex">
          <button
            type="button"
            onClick={onCerrarSesion}
            className={cn(CLASE_OPCION, 'text-destructive hover:bg-red-50')}
          >
            <LogOut className="h-6 w-6 shrink-0" aria-hidden="true" />
            Cerrar sesión
          </button>
        </li>
      </ul>
    </nav>
  );
}
