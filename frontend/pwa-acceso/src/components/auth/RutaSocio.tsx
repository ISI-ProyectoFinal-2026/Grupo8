import { useEffect, useState } from 'react';
import { Link, Outlet, useOutletContext } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { ErrorPerfil, obtenerUsuarioActual, type UsuarioSesion } from '@/lib/auth';

/**
 * Ruta de layout para las pantallas exclusivas de socios. Consulta GET /auth/me y solo deja
 * pasar a quien es socio. Un socio con la membresía vencida también entra, para poder ver
 * su estado. Los datos del usuario quedan disponibles para las pantallas hijas.
 */
export function RutaSocio() {
  const { token } = useAuth();
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!token) return;
    const controlador = new AbortController();
    setUsuario(null);
    setError(null);
    obtenerUsuarioActual(token, controlador.signal)
      .then(setUsuario)
      .catch((e) => {
        if (controlador.signal.aborted) return;
        setError(
          e instanceof ErrorPerfil
            ? e.message
            : 'No pudimos conectar con el servidor. Intentá nuevamente.'
        );
      });
    return () => controlador.abort();
  }, [token, intento]);

  if (error) {
    return (
      <div role="alert" className="container mx-auto max-w-md space-y-3 px-4 py-16 text-center text-red-600">
        <p>{error}</p>
        <Button variant="outline" onClick={() => setIntento((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!usuario) {
    return (
      <p role="status" className="py-16 text-center text-zinc-500">
        Cargando…
      </p>
    );
  }

  if (!usuario.is_socio) {
    return (
      <div className="container mx-auto max-w-md space-y-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">Solo para socios</h1>
        <p className="text-zinc-600">Esta sección está disponible únicamente para socios del club.</p>
        <Button asChild>
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  return <Outlet context={usuario} />;
}

/** Datos del socio con sesión, para usar dentro de las pantallas que cuelgan de RutaSocio. */
export function useUsuarioSocio() {
  return useOutletContext<UsuarioSesion>();
}