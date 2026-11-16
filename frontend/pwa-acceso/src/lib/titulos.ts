import { adminRoutes } from '@/pages/admin/routes';

/**
 * Títulos de la pestaña del navegador (WCAG 2.4.2, "Página titulada").
 * Cada pantalla tiene un título propio, y el nombre de la app va al final para que el
 * lector de pantalla anuncie primero dónde se está.
 */

const APP_WEB = 'Qamp';
const APP_ACCESO = 'Qamp Acceso';
const APP_PANEL = 'Qamp Panel';

/** Web de reservas. Incluye las rutas acordadas para el botón de arrepentimiento (25.3). */
const TITULOS_WEB: Record<string, string> = {
  '/': 'Inicio',
  '/disponibilidad': 'Disponibilidad',
  '/login': 'Iniciar sesión',
  '/reservas': 'Completá tu reserva',
  '/reservas/pagar': 'Pagar reserva',
  '/beneficios': 'Beneficios',
  '/acerca': 'Acerca de',
  '/contacto': 'Contacto',
  '/pago/exito': 'Pago aprobado',
  '/pago/rechazado': 'Pago rechazado',
  '/pago/pendiente': 'Pago pendiente',
  '/perfil': 'Mi perfil',
  '/mis-reservas': 'Mis reservas',
  '/arrepentimiento': 'Botón de arrepentimiento',
  '/cancelar-reserva': 'Cancelar reserva',
};

/** PWA del guardia. Incluye la ruta de la 26.3 aunque todavía no esté integrada. */
const TITULOS_ACCESO: Record<string, string> = {
  '/acceso/login': 'Ingreso del guardia',
  '/acceso': 'Escáner',
  '/acceso/manual': 'Registro manual',
  '/acceso/historial': 'Historial',
  '/acceso/sincronizacion': 'Estado de sincronización',
};

/**
 * Panel de administración. Los títulos salen del mismo registro que arma el menú
 * (pages/admin/routes.tsx): una pantalla nueva del panel ya tiene título sin tocar este archivo.
 */
const TITULOS_PANEL: Record<string, string> = {
  '/admin/login': 'Ingreso al panel',
  ...Object.fromEntries(
    adminRoutes.map(({ path, titulo }) => [
      path ? `/admin/${path}` : '/admin',
      titulo,
    ])
  ),
};

const armarTitulo = (pantalla: string | undefined, app: string): string =>
  pantalla ? `${pantalla} | ${app}` : app;

const esDeLaApp = (ruta: string, base: string): boolean =>
  ruta === base || ruta.startsWith(`${base}/`);

/** Título de la pestaña para una ruta. Si la ruta no tiene título propio, queda el nombre de la app. */
export function tituloDeRuta(pathname: string): string {
  // "/mis-reservas/" y "/mis-reservas" son la misma pantalla
  const ruta = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (esDeLaApp(ruta, '/admin'))
    return armarTitulo(TITULOS_PANEL[ruta], APP_PANEL);
  if (esDeLaApp(ruta, '/acceso'))
    return armarTitulo(TITULOS_ACCESO[ruta], APP_ACCESO);
  return armarTitulo(TITULOS_WEB[ruta], APP_WEB);
}
