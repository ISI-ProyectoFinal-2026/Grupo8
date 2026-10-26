import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import {
  crearDescuento,
  describirAplicacion,
  ErrorApi,
  formatearPorcentaje,
  formularioDesdeDescuento,
  formularioVacio,
  listarDescuentos,
  modificarDescuento,
  modificarDescuentoDesdeFormulario,
  validarDescuento,
  type AplicaDescuento,
  type Descuento,
  type DescuentoFormulario,
  type ErroresDescuento,
} from '@/lib/descuentos';

const CLASE_SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function MensajeError({ texto }: { texto?: string }) {
  return texto ? (
    <p role="alert" className="mt-1 text-sm text-red-600">
      {texto}
    </p>
  ) : null;
}

export default function Descuentos() {
  const { token } = useAuth();
  const [descuentos, setDescuentos] = useState<Descuento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [aviso, setAviso] = useState('');
  const [errorAccion, setErrorAccion] = useState('');

  // null = formulario cerrado; 'nuevo' = alta; otro valor = descuento que se está editando
  const [editando, setEditando] = useState<Descuento | 'nuevo' | null>(null);
  const [form, setForm] = useState<DescuentoFormulario>(formularioVacio);
  const [errores, setErrores] = useState<ErroresDescuento>({});
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
      setDescuentos(await listarDescuentos(token));
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

  const abrirEdicion = (descuento: Descuento) => {
    setEditando(descuento);
    setForm(formularioDesdeDescuento(descuento));
    setErrores({});
    setErrorServidor('');
    setAviso('');
  };

  const cerrarFormulario = () => {
    setEditando(null);
    setErrores({});
    setErrorServidor('');
  };

  const cambiar = <K extends keyof DescuentoFormulario>(
    campo: K,
    valor: DescuentoFormulario[K]
  ) => setForm((anterior) => ({ ...anterior, [campo]: valor }));

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!token || editando === null) return;

    const modo = editando === 'nuevo' ? 'crear' : 'editar';
    const erroresForm = validarDescuento(form, modo);
    setErrores(erroresForm);
    setErrorServidor('');
    if (Object.keys(erroresForm).length > 0) return;

    setGuardando(true);
    try {
      if (editando === 'nuevo') await crearDescuento(token, form);
      else await modificarDescuentoDesdeFormulario(token, editando.id, form);
      setAviso(editando === 'nuevo' ? 'Descuento creado.' : 'Descuento actualizado.');
      cerrarFormulario();
      await cargar();
    } catch (error) {
      setErrorServidor(manejarError(error));
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (descuento: Descuento) => {
    if (!token) return;
    setErrorAccion('');
    setAviso('');
    try {
      await modificarDescuento(token, descuento.id, { activo: !descuento.activo });
      setAviso(descuento.activo ? 'Descuento desactivado.' : 'Descuento activado.');
      await cargar();
    } catch (error) {
      setErrorAccion(manejarError(error));
    }
  };

  const esEdicion = editando !== null && editando !== 'nuevo';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Descuentos</h1>
          <p className="mt-1 text-zinc-600">
            Definí los descuentos para socios y por rango de edad. Los cambios no modifican las
            reservas ya creadas.
          </p>
        </div>
        {editando === null && (
          <Button onClick={abrirAlta} className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo descuento
          </Button>
        )}
      </div>

      {aviso && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {aviso}
        </p>
      )}
      {errorAccion && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorAccion}
        </p>
      )}

      {editando !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{esEdicion ? 'Editar descuento' : 'Nuevo descuento'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="descuento-codigo">Código</Label>
                <Input
                  id="descuento-codigo"
                  className="mt-1"
                  value={form.codigo}
                  disabled={esEdicion}
                  maxLength={30}
                  aria-invalid={!!errores.codigo}
                  onChange={(e) => cambiar('codigo', e.target.value)}
                />
                <MensajeError texto={errores.codigo} />
              </div>

              <div>
                <Label htmlFor="descuento-nombre">Nombre</Label>
                <Input
                  id="descuento-nombre"
                  className="mt-1"
                  value={form.nombre}
                  maxLength={100}
                  aria-invalid={!!errores.nombre}
                  onChange={(e) => cambiar('nombre', e.target.value)}
                />
                <MensajeError texto={errores.nombre} />
              </div>

              <div>
                <Label htmlFor="descuento-aplica">Aplica a</Label>
                <select
                  id="descuento-aplica"
                  className={`${CLASE_SELECT} mt-1`}
                  value={form.aplica_a}
                  disabled={esEdicion}
                  onChange={(e) => cambiar('aplica_a', e.target.value as AplicaDescuento)}
                >
                  <option value="socio">Socios</option>
                  <option value="edad">Rango de edad</option>
                </select>
              </div>

              <div>
                <Label htmlFor="descuento-porcentaje">Porcentaje de descuento (%)</Label>
                <Input
                  id="descuento-porcentaje"
                  className="mt-1"
                  inputMode="decimal"
                  value={form.porcentaje}
                  aria-invalid={!!errores.porcentaje}
                  onChange={(e) => cambiar('porcentaje', e.target.value)}
                />
                <MensajeError texto={errores.porcentaje} />
              </div>

              {form.aplica_a === 'edad' && (
                <>
                  <div>
                    <Label htmlFor="descuento-edad-min">Edad mínima</Label>
                    <Input
                      id="descuento-edad-min"
                      className="mt-1"
                      inputMode="numeric"
                      value={form.edad_min}
                      aria-invalid={!!errores.edad_min}
                      onChange={(e) => cambiar('edad_min', e.target.value)}
                    />
                    <MensajeError texto={errores.edad_min} />
                  </div>
                  <div>
                    <Label htmlFor="descuento-edad-max">Edad máxima</Label>
                    <Input
                      id="descuento-edad-max"
                      className="mt-1"
                      inputMode="numeric"
                      value={form.edad_max}
                      aria-invalid={!!errores.edad_max}
                      onChange={(e) => cambiar('edad_max', e.target.value)}
                    />
                    <MensajeError texto={errores.edad_max} />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="descuento-activo"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.activo}
                  onChange={(e) => cambiar('activo', e.target.checked)}
                />
                <Label htmlFor="descuento-activo">Activo</Label>
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
          {cargando && descuentos.length === 0 ? (
            <p className="p-6 text-zinc-600">Cargando descuentos…</p>
          ) : errorCarga ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-red-700">
                {errorCarga}
              </p>
              <Button variant="outline" onClick={() => void cargar()}>
                Reintentar
              </Button>
            </div>
          ) : descuentos.length === 0 ? (
            <p className="p-6 text-zinc-600">Todavía no hay descuentos cargados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Descuento</th>
                    <th className="px-4 py-3 font-medium">Aplica a</th>
                    <th className="px-4 py-3 font-medium">Porcentaje</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {descuentos.map((descuento) => (
                    <tr key={descuento.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900">{descuento.nombre}</div>
                        <div className="text-xs text-zinc-500">{descuento.codigo}</div>
                      </td>
                      <td className="px-4 py-3">{describirAplicacion(descuento)}</td>
                      <td className="px-4 py-3">{formatearPorcentaje(descuento.porcentaje)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={descuento.activo ? 'default' : 'secondary'}>
                          {descuento.activo ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Editar ${descuento.nombre}`}
                            onClick={() => abrirEdicion(descuento)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${descuento.activo ? 'Desactivar' : 'Activar'} ${descuento.nombre}`}
                            onClick={() => void cambiarEstado(descuento)}
                          >
                            {descuento.activo ? 'Desactivar' : 'Activar'}
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
