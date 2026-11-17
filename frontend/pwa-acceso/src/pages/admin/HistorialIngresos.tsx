import { useEffect, useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { hoyEnArgentina, validarRango } from '@/lib/cobros';
import { formatearFecha } from '@/lib/fechas';
import {
  ETIQUETA_TIPO_CLIENTE,
  numeroReserva,
  textoPaginacion,
  totalPaginas,
} from '@/lib/reservasAdmin';
import {
  IngresosApiError,
  mensajeDeError,
  obtenerHistorialIngresos,
  type ConsultaIngresos,
  type IngresosPaginados,
  type TipoIngreso,
} from '@/services/ingresosAdminService';

const ZONA_NEGOCIO = 'America/Argentina/Buenos_Aires';

// La hora siempre en Buenos Aires y en 24 h, aunque el administrador abra el panel desde
// otra zona o su navegador use a. m./p. m.
const HORA = {
  timeZone: ZONA_NEGOCIO,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
} as const;
const SOLO_HORA = new Intl.DateTimeFormat('es-AR', HORA);
const FECHA_Y_HORA = new Intl.DateTimeFormat('es-AR', {
  ...HORA,
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

const ETIQUETA_TIPO_INGRESO: Record<TipoIngreso, string> = {
  web: 'Web',
  manual: 'Manual',
};

export const AVISO_SINCRONIZACION =
  'Los ingresos registrados sin conexión aparecen cuando el dispositivo se sincroniza.';

interface Pedido extends ConsultaIngresos {
  // Cambia en cada pedido, así "Consultar" o "Reintentar" con los mismos datos vuelven a pedir
  numero: number;
}

/**
 * Historial de ingresos del panel (pantalla 4 del dashboard): todos los ingresos que el
 * servidor aceptó, de todos los dispositivos, filtrados por días de Buenos Aires.
 */
export default function HistorialIngresos() {
  const { token } = useAuth();
  const [hoy] = useState(() => hoyEnArgentina());
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [pedido, setPedido] = useState<Pedido>({
    desde: hoy,
    hasta: hoy,
    pagina: 0,
    numero: 0,
  });

  const [datos, setDatos] = useState<IngresosPaginados | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorRango, setErrorRango] = useState<string | null>(null);

  useEffect(() => {
    const control = new AbortController();
    setCargando(true);
    obtenerHistorialIngresos(token, pedido, control.signal)
      .then((respuesta) => {
        if (control.signal.aborted) return;
        setDatos(respuesta);
        setError(null);
      })
      .catch((e: unknown) => {
        if (control.signal.aborted) return;
        if (e instanceof IngresosApiError && e.status === 401) {
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
        setError(mensajeDeError(e));
      })
      .finally(() => {
        if (!control.signal.aborted) setCargando(false);
      });
    return () => control.abort();
  }, [token, pedido]);

  const consultar = (e: FormEvent) => {
    e.preventDefault();
    const problema = validarRango(desde, hasta);
    setErrorRango(problema);
    if (problema) return;
    setPedido((anterior) => ({
      desde,
      hasta,
      pagina: 0,
      numero: anterior.numero + 1,
    }));
  };

  const irAPagina = (pagina: number) =>
    setPedido((anterior) => ({
      ...anterior,
      pagina,
      numero: anterior.numero + 1,
    }));
  const reintentar = () => irAPagina(pedido.pagina);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900">
        Historial de ingresos
      </h1>

      {/* Consistencia eventual: el servidor solo conoce lo que ya le llegó */}
      <p className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {AVISO_SINCRONIZACION}
      </p>

      <form
        onSubmit={consultar}
        noValidate
        className="flex flex-wrap items-end gap-3"
      >
        <div className="space-y-1">
          <Label htmlFor="ingresos-desde">Desde</Label>
          <Input
            id="ingresos-desde"
            type="date"
            value={desde}
            max={hoy}
            onChange={(e) => setDesde(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ingresos-hasta">Hasta</Label>
          <Input
            id="ingresos-hasta"
            type="date"
            value={hasta}
            max={hoy}
            onChange={(e) => setHasta(e.target.value)}
            className="w-44"
          />
        </div>
        <Button type="submit" disabled={cargando}>
          Consultar
        </Button>
      </form>

      {errorRango && (
        <p role="alert" className="text-sm text-destructive">
          {errorRango}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {cargando && datos && (
            <p
              role="status"
              className="border-b px-4 py-2 text-xs text-zinc-600"
            >
              Actualizando…
            </p>
          )}
          {cargando && !datos ? (
            <p role="status" className="p-6 text-zinc-600">
              Cargando ingresos…
            </p>
          ) : error ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-red-700">
                {`No se pudo consultar el historial. ${error}`}
              </p>
              <Button variant="outline" onClick={reintentar}>
                Reintentar
              </Button>
            </div>
          ) : datos && datos.items.length === 0 ? (
            <p role="status" className="p-6 text-zinc-600">
              {datos.desde === datos.hasta
                ? `No hubo ingresos el ${formatearFecha(datos.desde)}.`
                : `No hubo ingresos entre el ${formatearFecha(datos.desde)} y el ${formatearFecha(datos.hasta)}.`}
            </p>
          ) : datos ? (
            <TablaIngresos datos={datos} />
          ) : null}
        </CardContent>
      </Card>

      {!error && datos && datos.items.length > 0 && (
        <nav
          aria-label="Paginación del historial de ingresos"
          className="flex items-center justify-between gap-3"
        >
          <p className="text-sm text-zinc-600">
            {textoPaginacion(pedido.pagina, datos.items.length, datos.total)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pedido.pagina === 0 || cargando}
              onClick={() => irAPagina(pedido.pagina - 1)}
            >
              Anterior
            </Button>
            <span className="text-sm text-zinc-600">{`Página ${pedido.pagina + 1} de ${totalPaginas(datos.total)}`}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={
                pedido.pagina + 1 >= totalPaginas(datos.total) || cargando
              }
              onClick={() => irAPagina(pedido.pagina + 1)}
            >
              Siguiente
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}

function TablaIngresos({ datos }: { datos: IngresosPaginados }) {
  // Si se consultó más de un día, la hora sola no alcanza para ubicar el ingreso
  const formato = datos.desde === datos.hasta ? SOLO_HORA : FECHA_Y_HORA;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Ingresos al camping, del más nuevo al más viejo
        </caption>
        <thead>
          <tr className="border-b text-left text-zinc-600">
            <th scope="col" className="px-4 py-3 font-medium">
              Hora de escaneo
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Reserva
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Pax
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Cliente
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Tipo de ingreso
            </th>
          </tr>
        </thead>
        <tbody>
          {datos.items.map((ingreso) => (
            <tr key={ingreso.id} className="border-b last:border-b-0">
              <th
                scope="row"
                className="whitespace-nowrap px-4 py-3 text-left font-normal"
              >
                <time dateTime={ingreso.fecha_hora_ingreso}>
                  {formato.format(new Date(ingreso.fecha_hora_ingreso))}
                </time>
              </th>
              <td className="px-4 py-3 font-mono text-xs">
                {ingreso.reserva_id ? (
                  numeroReserva(ingreso.reserva_id)
                ) : (
                  <span className="font-sans text-sm">Manual</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">{ingreso.personas}</td>
              <td className="px-4 py-3">
                {ETIQUETA_TIPO_CLIENTE[ingreso.tipo_cliente]}
              </td>
              <td className="px-4 py-3">
                {ETIQUETA_TIPO_INGRESO[ingreso.tipo_ingreso]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
