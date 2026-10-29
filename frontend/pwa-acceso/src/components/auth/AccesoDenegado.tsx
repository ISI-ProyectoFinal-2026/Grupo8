import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { RUTA_POR_ROL } from '@/lib/auth';

/** Pantalla para quien tiene sesión pero entró a una sección que no es de su rol. */
export function AccesoDenegado() {
  const { rol, cerrarSesion } = useAuth();

  return (
    <div className="container mx-auto max-w-md space-y-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-zinc-900">Acceso denegado</h1>
      <p className="text-zinc-600">Tu usuario no tiene permiso para ver esta sección.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {rol && (
          <Button asChild>
            <Link to={RUTA_POR_ROL[rol]}>Ir a mi pantalla</Link>
          </Button>
        )}
        <Button variant="outline" onClick={cerrarSesion}>
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
