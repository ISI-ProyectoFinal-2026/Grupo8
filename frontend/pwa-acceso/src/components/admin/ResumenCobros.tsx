import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { rangoPorDefecto, validarRango } from '@/lib/cobros';
import { formatearMonto } from '@/lib/cotizacion';
import { formatearFecha } from '@/lib/fechas';
import {
  CobrosApiError,
  mensajeDeError,
  obtenerResumenCobros,
  type ResumenCobros as Resumen,
} from '@/services/cobrosService';

interface Consulta {
  desde: string;
  hasta: string;
  // Cambia en cada pedido, así "Consultar" o "Reintentar" con el mismo rango vuelven a pedir los datos
  pedido: number;
}

export function ResumenCobros() {
  const { token } = useAuth();
  const [inicial] = useState(() => rangoPorDefecto());
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [consulta, setConsulta] = useState<Consulta>({ ...inicial, pedido: 0 });

  const [datos, setDatos] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorRango, setErrorRango] = useState<string | null>(null);

  useEffect(() => {
    const control = new AbortController();
    setCargando(true);
    obtenerResumenCobros(token, consulta.desde, consulta.hasta, control.signal)
      .then((resumen) => {
        if (control.signal.aborted) return;
        setDatos(resumen);
        setError(null);
      })
      .catch((e: unknown) => {
        if (control.signal.aborted) return;
        if (e instanceof CobrosApiError && e.status === 401) {
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
        setError(mensajeDeError(e));
      })
      .finally(() => {
        if (!control.signal.aborted) setCargando(false);
      });
    return () => control.abort();
  }, [token, consulta]);

  const consultar = (e: FormEvent) => {
    e.preventDefault();
    const problema = validarRango(desde, hasta);
    setErrorRango(problema);
    if (problema) return;
    setConsulta((anterior) => ({ desde, hasta, pedido: anterior.pedido + 1 }));
  };

  const reintentar = () => setConsulta((anterior) => ({ ...anterior, pedido: anterior.pedido + 1 }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumen de cobros</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={consultar} noValidate className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="cobros-desde">Desde</Label>
            <Input id="cobros-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cobros-hasta">Hasta</Label>
            <Input id="cobros-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-44" />
          </div>
          <Button type="submit" disabled={cargando}>
            Consultar
          </Button>
        </form>

        {errorRango && (
          <p role="alert" className="text-sm text-red-600">
            {errorRango}
          </p>
        )}

        {cargando && !datos && (
          <p role="status" className="text-zinc-600">
            Cargando cobros…
          </p>
        )}

        {error && !datos && (
          <div role="alert" className="space-y-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{`No se pudo consultar los cobros. ${error}`}</p>
            <Button type="button" variant="outline" size="sm" onClick={reintentar}>
              Reintentar
            </Button>
          </div>
        )}

        {datos && <Detalle resumen={datos} />}

        {/* Si ya había datos y falla una consulta nueva, se siguen mostrando los anteriores */}
        {error && datos && (
          <p role="alert" className="text-sm text-red-600">
            {`No se pudo actualizar el resumen: ${error}`}
          </p>
        )}

        <p className="text-xs text-zinc-500">
          Mercado Pago: solo pagos aprobados, en el día en que se aprobaron. Efectivo: lo cobrado en
          los ingresos manuales, que se suma cuando los guardias sincronizan.
        </p>
      </CardContent>
    </Card>
  );
}

function Detalle({ resumen }: { resumen: Resumen }) {
  const periodo = `${formatearFecha(resumen.desde)} y ${formatearFecha(resumen.hasta)}`;

  return (
    <div className="space-y-4">
      <dl aria-label="Totales del período" className="grid gap-3 sm:grid-cols-3">
        <Total titulo="Efectivo" monto={resumen.total_efectivo} />
        <Total titulo="Mercado Pago" monto={resumen.total_mercado_pago} />
        <Total titulo="Total" monto={resumen.total} destacado />
      </dl>

      {resumen.total === 0 ? (
        <p role="status" className="text-sm text-zinc-600">
          {`No hubo cobros entre el ${periodo}.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Cobros por día</caption>
            <thead>
              <tr className="border-b text-left text-zinc-500">
                <th scope="col" className="py-2 font-medium">Fecha</th>
                <th scope="col" className="py-2 text-right font-medium">Efectivo</th>
                <th scope="col" className="py-2 text-right font-medium">Mercado Pago</th>
                <th scope="col" className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {resumen.dias.map((dia) => (
                <tr key={dia.fecha} className="border-b last:border-0">
                  <th scope="row" className="py-2 text-left font-normal">{formatearFecha(dia.fecha)}</th>
                  <td className="py-2 text-right">{formatearMonto(dia.efectivo)}</td>
                  <td className="py-2 text-right">{formatearMonto(dia.mercado_pago)}</td>
                  <td className="py-2 text-right font-medium">{formatearMonto(dia.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Total({ titulo, monto, destacado = false }: { titulo: string; monto: number; destacado?: boolean }) {
  return (
    <div className={destacado ? 'rounded-md bg-zinc-900 p-3 text-white' : 'rounded-md bg-zinc-100 p-3'}>
      <dt className={destacado ? 'text-sm text-zinc-300' : 'text-sm text-zinc-500'}>{titulo}</dt>
      <dd className="text-xl font-bold">{formatearMonto(monto)}</dd>
    </div>
  );
}
