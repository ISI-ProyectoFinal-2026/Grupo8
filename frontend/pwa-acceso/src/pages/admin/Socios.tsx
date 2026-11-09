import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import AccionesSocio from '@/components/admin/AccionesSocio';
import FiltrosSocios from '@/components/admin/FiltrosSocios';
import FormularioEdicionSocio from '@/components/admin/FormularioEdicionSocio';
import FormularioRenovacionSocio from '@/components/admin/FormularioRenovacionSocio';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { ErrorApi } from '@/lib/descuentos';
import { formatearFecha } from '@/lib/fechas';
import {
  crearSocio,
  darDeBaja,
  editarSocio,
  estadoDeSocio,
  ETIQUETA_ESTADO,
  filtrosVacios,
  formularioVacio,
  hayFiltros,
  listarSocios,
  PASSWORD_MIN,
  reactivarSocio,
  renovarMembresia,
  validarSocio,
  type EdicionFormulario,
  type ErroresSocio,
  type EstadoSocio,
  type FiltrosSocios as Filtros,
  type Socio,
  type SocioFormulario,
} from '@/lib/socios';
import { useValorDiferido } from '@/lib/useValorDiferido';
import { limpiarNombre, soloDigitos } from '@/lib/validaciones';

// Espera después de la última tecla antes de pedir la lista filtrada
const DEMORA_BUSQUEDA_MS = 300;

const VARIANTE_ESTADO: Record<EstadoSocio, BadgeProps['variant']> = {
  vigente: 'default',
  vencida: 'secondary',
  baja: 'outline',
};

// Un solo panel abierto a la vez: alta, edición o renovación de un socio
type Panel = { tipo: 'alta' } | { tipo: 'editar'; socio: Socio } | { tipo: 'renovar'; socio: Socio } | null;

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

  const [filtros, setFiltros] = useState<Filtros>(filtrosVacios);
  const buscarDiferido = useValorDiferido(filtros.buscar, DEMORA_BUSQUEDA_MS);
  // El estado se aplica enseguida; el texto, cuando se deja de escribir
  const filtrosAplicados = useMemo<Filtros>(
    () => ({ buscar: buscarDiferido, estado: filtros.estado }),
    [buscarDiferido, filtros.estado]
  );

  const [panel, setPanel] = useState<Panel>(null);
  const [form, setForm] = useState<SocioFormulario>(formularioVacio);
  const [errores, setErrores] = useState<ErroresSocio>({});
  const [errorServidor, setErrorServidor] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Socio con una baja o reactivación en curso, y el error de esa operación
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState('');

  // Si se escribe rápido, una respuesta vieja puede llegar después de una nueva:
  // solo se muestra la del último pedido
  const ultimoPedido = useRef(0);

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
    const pedido = ++ultimoPedido.current;
    setCargando(true);
    setErrorCarga('');
    try {
      const lista = await listarSocios(token, filtrosAplicados);
      if (pedido === ultimoPedido.current) setSocios(lista);
    } catch (error) {
      if (pedido === ultimoPedido.current) setErrorCarga(manejarError(error));
    } finally {
      if (pedido === ultimoPedido.current) setCargando(false);
    }
  }, [token, filtrosAplicados, manejarError]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const formularioAbierto = panel?.tipo === 'alta';

  const abrirPanel = (nuevo: Exclude<Panel, null>) => {
    setPanel(nuevo);
    setAviso('');
    setErrorAccion('');
  };

  const abrirAlta = () => {
    abrirPanel({ tipo: 'alta' });
    setForm(formularioVacio);
    setErrores({});
    setErrorServidor('');
  };

  const cerrarFormulario = () => {
    setPanel(null);
    setErrores({});
    setErrorServidor('');
  };

  // Edición y renovación: si falla, el formulario muestra el mensaje y queda abierto
  const guardarEdicion = async (socio: Socio, cambios: Partial<EdicionFormulario>) => {
    if (!token) return;
    try {
      await editarSocio(token, socio.id, cambios);
    } catch (error) {
      throw new Error(manejarError(error), { cause: error });
    }
    setPanel(null);
    setAviso('Datos del socio actualizados.');
    await cargar();
  };

  const renovar = async (socio: Socio, membresiaVence: string) => {
    if (!token) return;
    try {
      await renovarMembresia(token, socio.id, membresiaVence);
    } catch (error) {
      throw new Error(manejarError(error), { cause: error });
    }
    setPanel(null);
    setAviso('Membresía renovada.');
    await cargar();
  };

  // Baja y reactivación se aplican desde la fila; el error se muestra arriba del listado
  const cambiarActivo = async (socio: Socio, operacion: 'baja' | 'reactivar') => {
    if (!token) return;
    setOcupadoId(socio.id);
    setAviso('');
    setErrorAccion('');
    try {
      if (operacion === 'baja') await darDeBaja(token, socio.id);
      else await reactivarSocio(token, socio.id);
      // Si estaba abierto un formulario de ese socio, ya no corresponde
      setPanel((actual) => (actual && actual.tipo !== 'alta' && actual.socio.id === socio.id ? null : actual));
      setAviso(operacion === 'baja' ? `${socio.nombre} fue dado de baja.` : `${socio.nombre} fue reactivado.`);
      await cargar();
    } catch (error) {
      setErrorAccion(manejarError(error));
    } finally {
      setOcupadoId(null);
    }
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
            Das de alta a los socios, corregís sus datos, renovás su membresía y los das de baja.
            Cada socio ingresa con su DNI o email y la contraseña inicial que cargues acá.
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

      {panel?.tipo === 'editar' && (
        <FormularioEdicionSocio
          key={panel.socio.id}
          socio={panel.socio}
          onGuardar={(cambios) => guardarEdicion(panel.socio, cambios)}
          onCancelar={() => setPanel(null)}
        />
      )}

      {panel?.tipo === 'renovar' && (
        <FormularioRenovacionSocio
          key={panel.socio.id}
          socio={panel.socio}
          onRenovar={(fecha) => renovar(panel.socio, fecha)}
          onCancelar={() => setPanel(null)}
        />
      )}

      <FiltrosSocios filtros={filtros} onCambiar={setFiltros} />

      {errorAccion && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorAccion}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando && socios.length > 0 && (
            <p role="status" className="border-b px-4 py-2 text-xs text-zinc-500">
              Buscando…
            </p>
          )}
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
            hayFiltros(filtrosAplicados) ? (
              <div className="space-y-3 p-6">
                <p className="text-zinc-600">Ningún socio coincide con la búsqueda.</p>
                <Button variant="outline" onClick={() => setFiltros(filtrosVacios)}>
                  Limpiar filtros
                </Button>
              </div>
            ) : (
              <p className="p-6 text-zinc-600">Todavía no hay socios cargados.</p>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Socio</th>
                    <th className="px-4 py-3 font-medium">DNI</th>
                    <th className="px-4 py-3 font-medium">Vence</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <span className="sr-only">Acciones</span>
                    </th>
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
                        <Badge variant={VARIANTE_ESTADO[estadoDeSocio(socio)]}>
                          {ETIQUETA_ESTADO[estadoDeSocio(socio)]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <AccionesSocio
                          socio={socio}
                          ocupado={ocupadoId === socio.id}
                          onEditar={() => abrirPanel({ tipo: 'editar', socio })}
                          onRenovar={() => abrirPanel({ tipo: 'renovar', socio })}
                          onDarDeBaja={() => cambiarActivo(socio, 'baja')}
                          onReactivar={() => void cambiarActivo(socio, 'reactivar')}
                        />
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
