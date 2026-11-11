import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { ErrorApi } from '@/lib/descuentos';
import {
  crearTipo,
  describirPrecio,
  formularioDesdeTipo,
  formularioVacio,
  listarTipos,
  modificarTipo,
  modificarTipoDesdeFormulario,
  validarTipo,
  type ErroresTipo,
  type FormaCobro,
  type TipoFormulario,
  type TipoReservaAdmin,
} from '@/lib/tiposReserva';

const CLASE_SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function MensajeError({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {texto}
    </p>
  ) : null;
}

function describirUnidades(tipo: TipoReservaAdmin): string {
  if (tipo.forma_cobro === 'POR_PERSONA') return '—';
  return tipo.cantidad_unidades === null
    ? 'Sin límite'
    : String(tipo.cantidad_unidades);
}

export default function TiposReserva() {
  const { token } = useAuth();
  const [tipos, setTipos] = useState<TipoReservaAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [aviso, setAviso] = useState('');
  const [errorAccion, setErrorAccion] = useState('');

  // null = formulario cerrado; 'nuevo' = alta; otro valor = tipo que se está editando
  const [editando, setEditando] = useState<TipoReservaAdmin | 'nuevo' | null>(
    null
  );
  const [form, setForm] = useState<TipoFormulario>(formularioVacio);
  const [errores, setErrores] = useState<ErroresTipo>({});
  const [errorServidor, setErrorServidor] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Una sesión vencida cierra la sesión desde el AuthContext
  const manejarError = useCallback((error: unknown): string => {
    if (error instanceof ErrorApi) {
      if (error.status === 401)
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      return error.message;
    }
    return 'Ocurrió un error inesperado. Intentá de nuevo.';
  }, []);

  const cargar = useCallback(async () => {
    if (!token) return;
    setCargando(true);
    setErrorCarga('');
    try {
      setTipos(await listarTipos(token));
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
    setEditando('nuevo');
    setForm(formularioVacio);
    setErrores({});
    setErrorServidor('');
    setAviso('');
  };

  const abrirEdicion = (tipo: TipoReservaAdmin) => {
    setEditando(tipo);
    setForm(formularioDesdeTipo(tipo));
    setErrores({});
    setErrorServidor('');
    setAviso('');
  };

  const cerrarFormulario = () => {
    setEditando(null);
    setErrores({});
    setErrorServidor('');
  };

  const cambiar = <K extends keyof TipoFormulario>(
    campo: K,
    valor: TipoFormulario[K]
  ) => setForm((anterior) => ({ ...anterior, [campo]: valor }));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!token || editando === null) return;

    const erroresForm = validarTipo(form);
    setErrores(erroresForm);
    setErrorServidor('');
    if (Object.keys(erroresForm).length > 0) return;

    setGuardando(true);
    try {
      if (editando === 'nuevo') await crearTipo(token, form);
      else await modificarTipoDesdeFormulario(token, editando.id, form);
      setAviso(
        editando === 'nuevo'
          ? 'Tipo de reserva creado.'
          : 'Tipo de reserva actualizado.'
      );
      cerrarFormulario();
      await cargar();
    } catch (error) {
      setErrorServidor(manejarError(error));
    } finally {
      setGuardando(false);
    }
  };

  // Desactivar no borra nada: el tipo deja de ofrecerse y las reservas que lo usan no cambian
  const cambiarEstado = async (tipo: TipoReservaAdmin) => {
    if (!token) return;
    setErrorAccion('');
    setAviso('');
    try {
      await modificarTipo(token, tipo.id, { activo: !tipo.activo });
      setAviso(
        tipo.activo
          ? 'Tipo de reserva desactivado.'
          : 'Tipo de reserva activado.'
      );
      await cargar();
    } catch (error) {
      setErrorAccion(manejarError(error));
    }
  };

  const esEdicion = editando !== null && editando !== 'nuevo';
  const porUnidad = form.forma_cobro === 'POR_UNIDAD';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Tipos de reserva</h1>
          <p className="mt-1 text-zinc-600">
            Definí qué se puede reservar desde la web, su precio y cómo se
            cobra. Desactivar un tipo no modifica las reservas que ya lo usan.
          </p>
        </div>
        {editando === null && (
          <Button onClick={abrirAlta} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo tipo
          </Button>
        )}
      </div>

      {aviso && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {aviso}
        </p>
      )}
      {errorAccion && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorAccion}
        </p>
      )}

      {editando !== null && (
        <Card>
          <CardHeader>
            <CardTitle>
              {esEdicion ? 'Editar tipo de reserva' : 'Nuevo tipo de reserva'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={guardar}
              noValidate
              className="grid gap-4 sm:grid-cols-2"
            >
              <div>
                <Label htmlFor="tipo-nombre">Nombre</Label>
                <Input
                  id="tipo-nombre"
                  className="mt-1"
                  value={form.nombre}
                  maxLength={80}
                  aria-invalid={!!errores.nombre}
                  onChange={(e) => cambiar('nombre', e.target.value)}
                />
                <MensajeError texto={errores.nombre} />
              </div>

              <div>
                <Label htmlFor="tipo-forma">Forma de cobro</Label>
                <select
                  id="tipo-forma"
                  className={`${CLASE_SELECT} mt-1`}
                  value={form.forma_cobro}
                  onChange={(e) =>
                    cambiar('forma_cobro', e.target.value as FormaCobro)
                  }
                >
                  <option value="POR_PERSONA">Por persona</option>
                  <option value="POR_UNIDAD">Por unidad y por noche</option>
                </select>
              </div>

              <div>
                <Label htmlFor="tipo-precio">
                  {porUnidad
                    ? 'Precio por noche ($)'
                    : 'Precio por persona ($)'}
                </Label>
                <Input
                  id="tipo-precio"
                  className="mt-1"
                  inputMode="decimal"
                  value={form.precio}
                  aria-invalid={!!errores.precio}
                  onChange={(e) => cambiar('precio', e.target.value)}
                />
                <MensajeError texto={errores.precio} />
              </div>

              <div>
                <Label htmlFor="tipo-maximo">
                  Máximo de personas por reserva
                </Label>
                <Input
                  id="tipo-maximo"
                  className="mt-1"
                  inputMode="numeric"
                  value={form.max_personas}
                  aria-invalid={!!errores.max_personas}
                  onChange={(e) => cambiar('max_personas', e.target.value)}
                />
                <MensajeError texto={errores.max_personas} />
              </div>

              {porUnidad && (
                <div>
                  <Label htmlFor="tipo-unidades">Cantidad de unidades</Label>
                  <Input
                    id="tipo-unidades"
                    className="mt-1"
                    inputMode="numeric"
                    placeholder="Sin límite"
                    value={form.cantidad_unidades}
                    aria-invalid={!!errores.cantidad_unidades}
                    aria-describedby="tipo-unidades-ayuda"
                    onChange={(e) =>
                      cambiar('cantidad_unidades', e.target.value)
                    }
                  />
                  <MensajeError texto={errores.cantidad_unidades} />
                  <p
                    id="tipo-unidades-ayuda"
                    className="mt-1 text-xs text-zinc-500"
                  >
                    Cuántas se pueden reservar por noche. Vacío = sin límite.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="tipo-activo"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.activo}
                  onChange={(e) => cambiar('activo', e.target.checked)}
                />
                <Label htmlFor="tipo-activo">
                  Activo (se ofrece en la web de reservas)
                </Label>
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={cerrarFormulario}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando && tipos.length === 0 ? (
            <p className="p-6 text-zinc-600">Cargando tipos de reserva…</p>
          ) : errorCarga ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-red-700">
                {errorCarga}
              </p>
              <Button variant="outline" onClick={() => void cargar()}>
                Reintentar
              </Button>
            </div>
          ) : tipos.length === 0 ? (
            <p className="p-6 text-zinc-600">
              Todavía no hay tipos de reserva cargados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Precio</th>
                    <th className="px-4 py-3 font-medium">Máx. personas</th>
                    <th className="px-4 py-3 font-medium">Unidades</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {tipos.map((tipo) => (
                    <tr key={tipo.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        {tipo.nombre}
                      </td>
                      <td className="px-4 py-3">{describirPrecio(tipo)}</td>
                      <td className="px-4 py-3">{tipo.max_personas}</td>
                      <td className="px-4 py-3">{describirUnidades(tipo)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={tipo.activo ? 'default' : 'secondary'}>
                          {tipo.activo ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Editar ${tipo.nombre}`}
                            onClick={() => abrirEdicion(tipo)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${tipo.activo ? 'Desactivar' : 'Activar'} ${tipo.nombre}`}
                            onClick={() => void cambiarEstado(tipo)}
                          >
                            {tipo.activo ? 'Desactivar' : 'Activar'}
                          </Button>
                        </div>
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
