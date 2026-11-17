import { AlertTriangle } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { LogoQamp } from '@/components/marca/LogoQamp';
import { AccesoDenegado } from '@/components/auth/AccesoDenegado';
import { FormularioLogin } from '@/components/auth/FormularioLogin';
import { useAuth } from '@/context/AuthContext';
import { RUTA_POR_ROL } from '@/lib/auth';

/**
 * Inicio de sesión de la PWA del guardia. Mantiene el diseño de la app de acceso:
 * barra verde, campos y botón grandes y alto contraste para usarla en la entrada.
 */
export default function LoginAcceso() {
  const { rol, avisoSesion } = useAuth();

  if (rol === 'SEGURIDAD') return <Navigate to={RUTA_POR_ROL.SEGURIDAD} replace />;
  if (rol) return <AccesoDenegado />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-lateral text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
          <LogoQamp tamanio={28} />
          <span className="rounded-full border border-white/25 px-3 py-1 text-xs font-medium">
            Control de acceso
          </span>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <h1 className="mb-2 text-3xl font-bold text-foreground">Control de acceso</h1>
        <p className="mb-8 text-lg text-muted-foreground">Ingreso del personal de seguridad</p>
        {/* Por qué se cerró la sesión, por ejemplo cuando el servidor rechazó el token al sincronizar */}
        {avisoSesion && (
          <p
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            {avisoSesion}
          </p>
        )}
        <FormularioLogin
          roles={['SEGURIDAD']}
          claseCampo="h-12 border-2 border-tierra-400 text-lg"
          claseBoton="h-14 text-lg font-bold"
        />
      </main>
    </div>
  );
}
