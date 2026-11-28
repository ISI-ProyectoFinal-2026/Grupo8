import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Rol } from '@/context/AuthContext';
import { AccesoDenegado } from './AccesoDenegado';

interface RutaProtegidaProps {
  roles: Rol[];
  /** Inicio de sesión de la app a la que pertenece la ruta. Por defecto, el de la web de reservas. */
  rutaLogin?: string;
}

/**
 * Ruta de layout: renderiza sus rutas hijas solo si hay sesión con alguno de los roles indicados.
 * Sin sesión redirige al login de su app (recordando la ruta pedida); con otro rol muestra
 * "Acceso denegado". La autorización real la hace el backend en cada request; esto solo protege la interfaz.
 */
export function RutaProtegida({ roles, rutaLogin = '/login' }: RutaProtegidaProps) {
  const { rol, cargando } = useAuth();
  const location = useLocation();

  // La sesión del guardia se lee de IndexedDB: hasta que termina, mandarlo al login sería un error.
  // Las de la web y el panel están en localStorage y ya se leyeron, así que esas rutas no esperan.
  if (!rol && cargando && roles.includes('SEGURIDAD')) return <p role="status" className="p-6 text-center text-lg">Abriendo la sesión…</p>;
  if (!rol) return <Navigate to={rutaLogin} replace state={{ from: location }} />;
  if (!roles.includes(rol)) return <AccesoDenegado />;
  return <Outlet />;
}
