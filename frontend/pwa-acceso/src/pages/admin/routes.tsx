import {
  Gauge,
  LayoutDashboard,
  Percent,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import Descuentos from './Descuentos';
import Incidentes from './Incidentes';
import Inicio from './Inicio';
import Ocupacion from './Ocupacion';
import Socios from './Socios';
import { Alertas } from './Alertas';

export interface AdminRoute {
  /** Ruta relativa a /admin. Cadena vacía = inicio del panel. */
  path: string;
  /** Texto del enlace en la navegación del panel. */
  titulo: string;
  icono: LucideIcon;
  element: ReactElement;
}

/**
 * Registro de pantallas del panel de administración.
 * Para integrar una pantalla basta con reemplazar el contenido de su archivo en
 * `pages/admin/`. Para sumar una sección nueva, agregar una entrada acá: el layout
 * y App.tsx no se modifican.
 */
export const adminRoutes: AdminRoute[] = [
  { path: '', titulo: 'Inicio', icono: LayoutDashboard, element: <Inicio /> },
  { path: 'socios', titulo: 'Socios', icono: Users, element: <Socios /> },
  {
    path: 'descuentos',
    titulo: 'Descuentos',
    icono: Percent,
    element: <Descuentos />,
  },
  {
    path: 'incidentes',
    titulo: 'Incidentes',
    icono: ShieldAlert,
    element: <Incidentes />,
  },
  {
    path: 'ocupacion',
    titulo: 'Ocupación',
    icono: Gauge,
    element: <Ocupacion />,
  },
  {
    path:'alertas',
    titulo: 'Alertas',
    icono: ShieldAlert,
    element: <Alertas />,
  },
];