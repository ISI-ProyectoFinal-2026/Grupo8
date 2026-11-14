import { Tent } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { AccesoDenegado } from '@/components/auth/AccesoDenegado';
import { FormularioLogin } from '@/components/auth/FormularioLogin';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { RUTA_POR_ROL } from '@/lib/auth';

/** Inicio de sesión del panel de administración, con la misma barra oscura del panel. */
export default function LoginAdmin() {
  const { rol } = useAuth();

  if (rol === 'ADMIN') return <Navigate to={RUTA_POR_ROL.ADMIN} replace />;
  if (rol) return <AccesoDenegado />;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900 text-white">
        <div className="flex h-14 items-center gap-2 px-4">
          <Tent className="h-5 w-5 text-green-500" />
          <span className="font-bold">Qamp</span>
          <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
            Administración
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md border-zinc-200 shadow-lg">
          <CardHeader className="text-center">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">
              Panel de administración
            </h1>
            <CardDescription>Ingresá con tu cuenta de administrador</CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioLogin roles={['ADMIN']} claseBoton="bg-zinc-900 hover:bg-zinc-800" />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
