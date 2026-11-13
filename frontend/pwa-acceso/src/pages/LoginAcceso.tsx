import { Tent } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { AccesoDenegado } from '@/components/auth/AccesoDenegado';
import { FormularioLogin } from '@/components/auth/FormularioLogin';
import { useAuth } from '@/context/AuthContext';
import { RUTA_POR_ROL } from '@/lib/auth';

/**
 * Inicio de sesión de la PWA del guardia. Mantiene el diseño de la app de acceso:
 * barra verde, campos y botón grandes y alto contraste para usarla en la entrada.
 */
export default function LoginAcceso() {
  const { rol } = useAuth();

  if (rol === 'SEGURIDAD') return <Navigate to={RUTA_POR_ROL.SEGURIDAD} replace />;
  if (rol) return <AccesoDenegado />;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-green-700 text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Tent className="h-5 w-5" />
          <span className="font-bold">Qamp</span>
          <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
            Control de acceso
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <h1 className="mb-2 text-3xl font-black text-zinc-900">Control de acceso</h1>
        <p className="mb-8 text-lg text-zinc-700">Ingreso del personal de seguridad</p>
        <FormularioLogin
          roles={['SEGURIDAD']}
          claseCampo="h-12 border-2 border-zinc-400 text-lg"
          claseBoton="h-14 bg-green-700 text-lg font-bold hover:bg-green-800"
        />
      </main>
    </div>
  );
}
