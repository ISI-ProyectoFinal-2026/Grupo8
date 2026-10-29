import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { ErrorApi } from '@/lib/descuentos';
import { formatearFecha } from '@/lib/fechas';
import {
  crearSocio,
  formularioVacio,
  listarSocios,
  PASSWORD_MIN,
  validarSocio,
  type ErroresSocio,
  type Socio,
  type SocioFormulario,
} from '@/lib/socios';
import { limpiarNombre, soloDigitos } from '@/lib/validaciones';

function MensajeError({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {texto}
    </p>
  ) : null;
}

export default function Socios() {
  const { token } = useAuth();
  const [socios, setSocios] = useState<Socio[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [aviso, setAviso] = useState('');

  const [formularioAbierto, setFormularioAbierto] = useState(false);
  const [form, setForm] = useState<SocioFormulario>(formularioVacio);
  const [errores, setErrores] = useState<ErroresSocio>({});
  const [errorServidor, setErrorServidor] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Una sesión vencida cierra la sesión desde el AuthContext
  const manejarError = useCallback((error: unknown): string => {
    if (error instanceof ErrorApi) {
      if (error.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      return error.message;
    }
    return 'Ocurrió un error inesperado. Intentá de nuevo.';
  }, []);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    setErrorCarga('');
    try {
      setSocios(await listarSocios(token));
    } catch (error) {
      setErrorCarga(manejarError(error));
    } finally {
      setCargando(false);
    }
  }, [token, manejarError]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const abrirAlta = () => {
    setFormularioAbierto(true);
    setForm(formularioVacio);
    setErrores({});
    setErrorServidor('');
    setAviso('');
  };

  const cerrarFormulario = () => {
    setFormularioAbierto(false);
    setErrores({});
    setErrorServidor('');
  };

  const cambiar = (campo: keyof SocioFormulario, valor: string) =>
    setForm((anterior) => ({ ...anterior, [campo]: valor }));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!token) return;

    const erroresForm = validarSocio(form);
    setErrores(erroresForm);
    setErrorServidor('');
    if (Object.keys(erroresForm).length > 0) return;

    setGuardando(true);
    try {
      await crearSocio(token, form);
      setAviso('Socio creado.');
      cerrarFormulario();
      await cargar();
    } catch (error) {
      setErrorServidor(manejarError(error));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Socios</h1>
          <p className="mt-1 text-zinc-600">
            Das de alta a los socios y definís hasta cuándo tienen la cuota al día. Cada socio
            ingresa con su DNI o email y la contraseña inicial que cargues acá.
          </p>
        </div>
        {!formularioAbierto && (
          <Button onClick={abrirAlta} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo socio
          </Button>
        )}
      </div>

      {aviso && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {aviso}
        </p>
      )}

      {formularioAbierto && (
        <Card>
          <CardHeader>
            <CardTitle>Nuevo socio</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="socio-nombre">Nombre</Label>
                <Input
                  id="socio-nombre"
                  className="mt-1"
                  value={form.nombre}
                  maxLength={100}
                  aria-invalid={!!errores.nombre}
                  onChange={(e) => cambiar('nombre', limpiarNombre(e.target.value))}
                />
                <MensajeError texto={errores.nombre} />
              </div>

              <div>
                <Label htmlFor="socio-dni">DNI</Label>
                <Input
                  id="socio-dni"
                  className="mt-1"
                  inputMode="numeric"
                  value={form.dni}
                  maxLength={8}
                  aria-invalid={!!errores.dni}
                  onChange={(e) => cambiar('dni', soloDigitos(e.target.value))}
                />
                <MensajeError texto={errores.dni} />
              </div>

              <div>
                <Label htmlFor="socio-email">Email</Label>
                <Input
                  id="socio-email"
                  className="mt-1"
                  type="email"
                  value={form.email}
                  maxLength={254}
                  aria-invalid={!!errores.email}
                  onChange={(e) => cambiar('email', e.target.value)}
                />
                <MensajeError texto={errores.email} />
              </div>

              <div>
                <Label htmlFor="socio-password">Contraseña inicial</Label>
                <Input
                  id="socio-password"
                  className="mt-1"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  aria-invalid={!!errores.password}
                  onChange={(e) => cambiar('password', e.target.value)}
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Al menos {PASSWORD_MIN} caracteres. El socio la usa para su primer ingreso.
                </p>
                <MensajeError texto={errores.password} />
              </div>

              <div>
                <Label htmlFor="socio-vence">Vencimiento de la membresía</Label>
                <Input
                  id="socio-vence"
                  className="mt-1"
                  type="date"
                  value={form.membresia_vence}
                  aria-invalid={!!errores.membresia_vence}
                  onChange={(e) => cambiar('membresia_vence', e.target.value)}
                />
                <MensajeError texto={errores.membresia_vence} />
              </div>

              {errorServidor && (
                <p role="alert" className="text-sm text-red-600 sm:col-span-2">
                  {errorServidor}
                </p>
              )}

              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </Button>
                <Button type="button" variant="outline" onClick={cerrarFormulario}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando && socios.length === 0 ? (
            <p className="p-6 text-zinc-600">Cargando socios…</p>
          ) : errorCarga ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-red-700">
                {errorCarga}
              </p>
              <Button variant="outline" onClick={() => void cargar()}>
                Reintentar
              </Button>
            </div>
          ) : socios.length === 0 ? (
            <p className="p-6 text-zinc-600">Todavía no hay socios cargados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Socio</th>
                    <th className="px-4 py-3 font-medium">DNI</th>
                    <th className="px-4 py-3 font-medium">Vence</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {socios.map((socio) => (
                    <tr key={socio.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900">{socio.nombre}</div>
                        <div className="text-xs text-zinc-500">{socio.email}</div>
                      </td>
                      <td className="px-4 py-3">{socio.dni}</td>
                      <td className="px-4 py-3">
                        {socio.membresia_vence ? formatearFecha(socio.membresia_vence) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={socio.membresia_vigente ? 'default' : 'secondary'}>
                          {socio.membresia_vigente ? 'Vigente' : 'Vencida'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
