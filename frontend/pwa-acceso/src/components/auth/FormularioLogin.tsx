import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { rolDeToken, useAuth, type Rol } from '@/context/AuthContext';
import { ErrorLogin, MENSAJE_ACCESO_DENEGADO, solicitarLogin } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface FormularioLoginProps {
  /** Roles que pueden entrar a esta app. Con otro rol no se abre la sesión. */
  roles: Rol[];
  /** Clases extra para adaptar el formulario al diseño de cada app. */
  claseCampo?: string;
  claseBoton?: string;
}

/**
 * Formulario de inicio de sesión que comparten la web de reservas, el panel y la PWA del guardia.
 * Cada pantalla de login lo envuelve con su propio diseño y se encarga de redirigir
 * cuando la sesión queda abierta.
 */
export function FormularioLogin({ roles, claseCampo, claseBoton }: FormularioLoginProps) {
  const { iniciarSesion } = useAuth();
  const [identificacion, setIdentificacion] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const token = await solicitarLogin(identificacion, password);
      const rol = rolDeToken(token);
      // Las credenciales son válidas, pero el usuario no es de esta app: no se guarda la sesión
      if (rol && !roles.includes(rol)) {
        setError(MENSAJE_ACCESO_DENEGADO);
        return;
      }
      if (!iniciarSesion(token)) setError('No se pudo iniciar la sesión. Intentá de nuevo.');
    } catch (err) {
      setError(
        err instanceof ErrorLogin ? err.message : 'Ocurrió un error inesperado. Intentá de nuevo.'
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="identificacion">DNI o Email</Label>
        <Input
          id="identificacion"
          required
          autoComplete="username"
          placeholder="ej: emiliana@correo.com o 12345678"
          value={identificacion}
          onChange={(e) => setIdentificacion(e.target.value)}
          className={claseCampo}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={claseCampo}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Button type="submit" disabled={enviando} className={cn('mt-4 h-11 w-full text-md', claseBoton)}>
        {enviando ? 'Ingresando...' : 'Ingresar'}
      </Button>
    </form>
  );
}
