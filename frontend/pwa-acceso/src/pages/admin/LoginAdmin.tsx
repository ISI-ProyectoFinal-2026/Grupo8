import { Navigate } from 'react-router-dom';
import { LogoQamp } from '@/components/marca/LogoQamp';
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
    <div className="flex min-h-screen flex-col">
      <header className="bg-lateral text-white">
        <div className="flex h-16 items-center gap-3 px-6">
          <LogoQamp tamanio={28} />
          <span className="rounded-full border border-white/25 px-3 py-1 text-xs font-medium">
            Administración
          </span>
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="fondo-montanas" aria-hidden="true" />
        <Card className="relative w-full max-w-md">
          <CardHeader className="text-center">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">
              Panel de administración
            </h1>
            <CardDescription>Ingresá con tu cuenta de administrador</CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioLogin roles={['ADMIN']} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
