import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Rol } from '@/context/AuthContext';
import { AccesoDenegado } from './AccesoDenegado';

interface RutaProtegidaProps {
  roles: Rol[];
}

/**
 * Ruta de layout: renderiza sus rutas hijas solo si hay sesión con alguno de los roles indicados.
 * Sin sesión redirige a /login (recordando la ruta pedida); con otro rol muestra "Acceso denegado".
 * La autorización real la hace el backend en cada request; esto solo protege la interfaz.
 */
export function RutaProtegida({ roles }: RutaProtegidaProps) {
  const { rol } = useAuth();
  const location = useLocation();

  if (!rol) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!roles.includes(rol)) return <AccesoDenegado />;
  return <Outlet />;
}