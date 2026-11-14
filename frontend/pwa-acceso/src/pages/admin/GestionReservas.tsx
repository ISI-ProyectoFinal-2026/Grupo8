import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DetalleReserva from '@/components/admin/DetalleReserva';
import FiltrosReservas from '@/components/admin/FiltrosReservas';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { formatearMonto } from '@/lib/cotizacion';
import { ErrorApi } from '@/lib/descuentos';
import { formatearFecha } from '@/lib/fechas';
import {
  ETIQUETA_TIPO_CLIENTE,
  filtrosVacios,
  hayFiltros,
  listarReservas,
  numeroReserva,
  rangoInvalido,
  textoPaginacion,
  totalPaginas,
  type EstadoReserva,
  type FiltrosReservas as Filtros,
  type ReservaAdmin,
} from '@/lib/reservasAdmin';
import { useValorDiferido } from '@/lib/useValorDiferido';

// Espera después de la última tecla antes de pedir la lista filtrada
const DEMORA_BUSQUEDA_MS = 300;

const VARIANTE_ESTADO: Record<EstadoReserva, BadgeProps['variant']> = {
  Pendiente: 'secondary',
  Confirmada: 'default',
  Cancelada: 'outline',
  Finalizada: 'outline',
  'Alerta de clonación': 'destructive',
};

/** Gestión de reservas: todas las reservas, con filtros, paginación y detalle. */
export default function GestionReservas() {
  const { token } = useAuth();
  const [reservas, setReservas] = useState<ReservaAdmin[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [detalleId, setDetalleId] = useState<string | null>(null);

  const [filtros, setFiltros] = useState<Filtros>(filtrosVacios);
  const busquedaDiferida = useValorDiferido(filtros.busqueda, DEMORA_BUSQUEDA_MS);
  // Los selectores y las fechas se aplican enseguida; el texto, cuando se deja de escribir
  const { estadoReserva, tipoCliente, fechaDesde, fechaHasta } = filtros;
  const filtrosAplicados = useMemo<Filtros>(
    () => ({ busqueda: busquedaDiferida, estadoReserva, tipoCliente, fechaDesde, fechaHasta }),
    [busquedaDiferida, estadoReserva, tipoCliente, fechaDesde, fechaHasta]
  );

  // Si se cambian los filtros rápido, solo se muestra la respuesta del último pedido
  const ultimoPedido = useRef(0);

  const cargar = useCallback(async () => {
    if (!token || rangoInvalido(filtrosAplicados)) return;
    const pedido = ++ultimoPedido.current;
    setCargando(true);
    setError('');
    try {
      const datos = await listarReservas(token, filtrosAplicados, pagina);
      if (pedido !== ultimoPedido.current) return;
      setReservas(datos.items);
      setTotal(datos.total);
    } catch (e) {
      if (pedido !== ultimoPedido.current) return;
      if (e instanceof ErrorApi) {
        if (e.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        setError(e.message);
      } else {
        setError('Ocurrió un error inesperado. Intentá de nuevo.');
      }
    } finally {
      if (pedido === ultimoPedido.current) setCargando(false);
    }
  }, [token, filtrosAplicados, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Con filtros nuevos se vuelve a la primera página
  const cambiarFiltros = (nuevos: Filtros) => {
    setFiltros(nuevos);
    setPagina(0);
  };

  const paginas = totalPaginas(total);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900">Gestión de reservas</h1>

      <FiltrosReservas filtros={filtros} onCambiar={cambiarFiltros} />

      <Card>
        <CardContent className="p-0">
          {cargando && reservas.length > 0 && (
            <p role="status" className="border-b px-4 py-2 text-xs text-zinc-500">
              Buscando…
            </p>
          )}
          {cargando && reservas.length === 0 && !error ? (
            <p role="status" className="p-6 text-zinc-600">
              Cargando reservas…
            </p>
          ) : error ? (
            <div className="space-y-3 p-6">
              <p role="alert" className="text-red-700">
                {error}
              </p>
              <Button variant="outline" onClick={() => void cargar()}>
                Reintentar
              </Button>
            </div>
          ) : reservas.length === 0 ? (
            hayFiltros(filtrosAplicados) ? (
              <div className="space-y-3 p-6">
                <p className="text-zinc-600">Ninguna reserva coincide con los filtros.</p>
                <Button variant="outline" onClick={() => cambiarFiltros(filtrosVacios)}>
                  Limpiar filtros
                </Button>
              </div>
            ) : (
              <p className="p-6 text-zinc-600">Todavía no hay reservas.</p>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Reserva</th>
                    <th className="px-4 py-3 font-medium">Titular</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Fechas</th>
                    <th className="px-4 py-3 font-medium">Personas</th>
                    <th className="px-4 py-3 font-medium">Monto</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reservas.map((reserva) => (
                    <tr key={reserva.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-mono text-xs">{numeroReserva(reserva.id)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900">{reserva.titular}</div>
                        <div className="text-xs text-zinc-500">{reserva.email}</div>
                      </td>
                      <td className="px-4 py-3">{ETIQUETA_TIPO_CLIENTE[reserva.tipo_cliente]}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {`${formatearFecha(reserva.fecha_ingreso)} al ${formatearFecha(reserva.fecha_egreso)}`}
                      </td>
                      <td className="px-4 py-3">{reserva.cantidad_personas}</td>
                      <td className="whitespace-nowrap px-4 py-3">{formatearMonto(reserva.monto_total)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={VARIANTE_ESTADO[reserva.estado_reserva] ?? 'outline'}>
                            {reserva.estado_reserva}
                          </Badge>
                          <span className="text-xs text-zinc-500">{`Pago: ${reserva.estado_pago}`}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetalleId(reserva.id)}
                        >
                          Ver detalle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!error && reservas.length > 0 && (
        <nav aria-label="Paginación de reservas" className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">{textoPaginacion(pagina, reservas.length, total)}</p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagina === 0 || cargando}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="text-sm text-zinc-600">{`Página ${pagina + 1} de ${paginas}`}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagina + 1 >= paginas || cargando}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </nav>
      )}

      <DetalleReserva reservaId={detalleId} onCerrar={() => setDetalleId(null)} />
    </div>
  );
}
