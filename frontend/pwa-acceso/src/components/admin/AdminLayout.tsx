import { LogOut, Tent } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { adminRoutes } from '@/pages/admin/routes';

/**
 * Marco del panel de administración. Es independiente del de la web de reservas:
 * tiene su propia barra superior y su menú lateral. El menú se genera desde
 * `adminRoutes`, así que sumar una pantalla no requiere tocar este archivo.
 */
export function AdminLayout() {
  const { cerrarSesion } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-900 text-white">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Tent className="h-5 w-5 text-green-500" />
            <span className="font-bold">Qamp</span>
            <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
              Administración
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              <Link to="/">Ver sitio de reservas</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={cerrarSesion}
              className="gap-2 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <nav
          aria-label="Navegación del panel de administración"
          className="flex gap-1 overflow-x-auto border-b bg-white p-2 md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-r md:p-4"
        >
          {adminRoutes.map(({ path, titulo, icono: Icono }) => (
            <NavLink
              key={path}
              to={path === '' ? '/admin' : `/admin/${path}`}
              end={path === ''}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-green-600 text-white'
                    : 'text-zinc-700 hover:bg-zinc-100'
                )
              }
            >
              <Icono className="h-4 w-4" />
              {titulo}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}