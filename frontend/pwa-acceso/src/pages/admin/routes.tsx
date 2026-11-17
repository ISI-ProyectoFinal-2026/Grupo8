import {
  ClipboardList,
  DoorOpen,
  History,
  Home,
  LayoutDashboard,
  Percent,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import Configuracion from './Configuracion';
import Descuentos from './Descuentos';
import Egresos from './Egresos';
import GestionReservas from './GestionReservas';
import HistorialIngresos from './HistorialIngresos';
import Inicio from './Inicio';
import Socios from './Socios';
import TiposReserva from './TiposReserva';
import { Alertas } from './Alertas';

export interface AdminRoute {
  /** Ruta relativa a /admin. Cadena vacía = inicio del panel. */
  path: string;
  /** Texto del enlace en la navegación del panel. */
  titulo: string;
  icono: LucideIcon;
  element: ReactElement;
  /** Va al pie de la barra lateral, separada del resto y justo encima de "Cerrar sesión". */
  alPie?: boolean;
}

/**
 * Registro de pantallas del panel de administración.
 * Para integrar una pantalla basta con reemplazar el contenido de su archivo en
 * `pages/admin/`. Para sumar una sección nueva, agregar una entrada acá: el layout
 * y App.tsx no se modifican.
 */
export const adminRoutes: AdminRoute[] = [
  { path: '', titulo: 'Inicio', icono: LayoutDashboard, element: <Inicio /> },
  {
    path: 'reservas',
    titulo: 'Gestión de reservas',
    icono: ClipboardList,
    element: <GestionReservas />,
  },
  { path: 'socios', titulo: 'Socios', icono: Users, element: <Socios /> },
  {
    path: 'descuentos',
    titulo: 'Descuentos',
    icono: Percent,
    element: <Descuentos />,
  },
  // Pantalla 4 del dashboard: los ingresos de todos los dispositivos (26.6)
  {
    path: 'historial-ingresos',
    titulo: 'Historial de ingresos',
    icono: History,
    element: <HistorialIngresos />,
  },
  {
    path: 'egresos',
    titulo: 'Egresos',
    icono: DoorOpen,
    element: <Egresos />,
  },
  // Única sección de incidentes de acceso: la de "Incidentes" (pantalla vacía de la 15.1) se unificó acá en la 26.5
  {
    path: 'alertas',
    titulo: 'Alertas',
    icono: ShieldAlert,
    element: <Alertas />,
  },
  {
    path: 'configuracion',
    titulo: 'Configuración',
    icono: Settings,
    element: <Configuracion />,
    alPie: true,
  },
  {
    path: 'tipos-reserva',
    titulo: 'Tipos de reserva',
    icono: Home,
    element: <TiposReserva />,
  },
];