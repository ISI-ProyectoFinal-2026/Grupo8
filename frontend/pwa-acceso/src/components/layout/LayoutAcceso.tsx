import { LogOut, Tent } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';

/**
 * Marco de la PWA de control de acceso. Es independiente de la web de reservas y del
 * panel de administración: barra propia, sin menú público ni pie de página.
 */
export function LayoutAcceso() {
  const { cerrarSesion } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-green-700 text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Tent className="h-5 w-5" />
            <span className="font-bold">Qamp</span>
            <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
              Control de acceso
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={cerrarSesion}
            className="gap-2 text-white hover:bg-green-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}