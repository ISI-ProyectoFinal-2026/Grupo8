import { SaltarAlContenido } from '@/components/layout/SaltarAlContenido';
import { useFocoAlCambiarDePantalla } from '@/hooks/useFocoAlCambiarDePantalla';
import { ExternalLink, LogOut } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogoQamp } from '@/components/marca/LogoQamp';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { adminRoutes, type AdminRoute } from '@/pages/admin/routes';

const ID_CONTENIDO = 'contenido-panel';

const CLASE_OPCION =
  // Foco en blanco: el verde del anillo común no se ve sobre la barra lateral verde oscuro
  'flex items-center gap-3 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-white';

function OpcionMenu({ path, titulo, icono: Icono }: AdminRoute) {
  return (
    <NavLink
      to={path === '' ? '/admin' : `/admin/${path}`}
      end={path === ''}
      className={({ isActive }) =>
        cn(
          CLASE_OPCION,
          // La sección actual, en una píldora blanca como las pestañas de la web
          isActive ? 'bg-white text-lateral' : 'text-tierra-200 hover:bg-white/10 hover:text-white'
        )
      }
    >
      <Icono className="h-4 w-4" aria-hidden="true" />
      {titulo}
    </NavLink>
  );
}

/**
 * Marco del panel de administración. Es independiente del de la web de reservas:
 * barra lateral verde oscuro con el menú y una barra superior sin color, sobre el mismo
 * fondo que el resto. El menú se genera desde `adminRoutes`, así que sumar una pantalla
 * no requiere tocar este archivo.
 */
export function AdminLayout() {
  const { cerrarSesion } = useAuth();
  const principales = adminRoutes.filter((r) => !r.alPie);
  const alPie = adminRoutes.filter((r) => r.alPie);
  // Al cambiar de sección el foco pasa al contenido (27.3)
  const contenido = useFocoAlCambiarDePantalla<HTMLElement>();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Primer Tab: salta el menú lateral y lleva directo al contenido */}
      <SaltarAlContenido destino={contenido} idDestino={ID_CONTENIDO} />

      <aside className="relative z-10 bg-lateral text-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col">
        <div className="px-6 pb-2 pt-5 md:pb-6 md:pt-7">
          <LogoQamp tamanio={30} />
        </div>

        <nav
          aria-label="Navegación del panel de administración"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-x-visible md:overflow-y-auto md:pb-6"
        >
          {principales.map((ruta) => (
            <OpcionMenu key={ruta.path} {...ruta} />
          ))}

          {/* Configuración y la salida quedan abajo de todo, separadas del resto del menú */}
          <div className="flex gap-1 md:mt-auto md:flex-col md:border-t md:border-white/15 md:pt-4">
            {alPie.map((ruta) => (
              <OpcionMenu key={ruta.path} {...ruta} />
            ))}
            <button
              type="button"
              onClick={cerrarSesion}
              className={cn(CLASE_OPCION, 'text-tierra-200 hover:bg-white/10 hover:text-white')}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Cerrar sesión
            </button>
          </div>
        </nav>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="fondo-montanas" aria-hidden="true" />

        {/* Barra superior sin color propio: se ve el mismo fondo */}
        <header className="relative flex items-center justify-end gap-3 px-6 py-4">
          <span className="rounded-full border border-tierra-300 bg-white/70 px-3 py-1 text-xs font-medium text-tierra-700">
            Administración
          </span>
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Ver sitio de reservas
            </Link>
          </Button>
        </header>

        <main
          id={ID_CONTENIDO}
          ref={contenido}
          tabIndex={-1}
          className="relative min-w-0 flex-1 px-6 pb-10 focus:outline-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
