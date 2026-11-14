import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BUSQUEDA_MAX,
  ESTADOS_RESERVA,
  ETIQUETA_TIPO_CLIENTE,
  rangoInvalido,
  type EstadoReserva,
  type FiltrosReservas as Filtros,
  type TipoCliente,
} from '@/lib/reservasAdmin';

const CLASE_SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const TIPOS_CLIENTE: TipoCliente[] = ['socio', 'visitante'];

interface Props {
  filtros: Filtros;
  onCambiar: (filtros: Filtros) => void;
}

/** Búsqueda por titular, email o número, y filtros por estado, tipo de cliente y fechas de ingreso. */
export default function FiltrosReservas({ filtros, onCambiar }: Props) {
  const cambiar = <K extends keyof Filtros>(campo: K, valor: Filtros[K]) =>
    onCambiar({ ...filtros, [campo]: valor });

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <div>
          <Label htmlFor="reservas-buscar">Buscar</Label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              id="reservas-buscar"
              type="search"
              className="pl-9"
              placeholder="Titular, email o número de reserva"
              maxLength={BUSQUEDA_MAX}
              value={filtros.busqueda}
              onChange={(e) => cambiar('busqueda', e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="reservas-estado">Estado</Label>
          <select
            id="reservas-estado"
            className={`${CLASE_SELECT} mt-1`}
            value={filtros.estadoReserva}
            onChange={(e) => cambiar('estadoReserva', e.target.value as EstadoReserva | '')}
          >
            <option value="">Todos</option>
            {ESTADOS_RESERVA.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="reservas-tipo-cliente">Tipo de cliente</Label>
          <select
            id="reservas-tipo-cliente"
            className={`${CLASE_SELECT} mt-1`}
            value={filtros.tipoCliente}
            onChange={(e) => cambiar('tipoCliente', e.target.value as TipoCliente | '')}
          >
            <option value="">Todos</option>
            {TIPOS_CLIENTE.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETA_TIPO_CLIENTE[tipo]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="reservas-desde">Ingreso desde</Label>
          <Input
            id="reservas-desde"
            type="date"
            className="mt-1"
            value={filtros.fechaDesde}
            onChange={(e) => cambiar('fechaDesde', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="reservas-hasta">Ingreso hasta</Label>
          <Input
            id="reservas-hasta"
            type="date"
            className="mt-1"
            value={filtros.fechaHasta}
            aria-invalid={rangoInvalido(filtros)}
            onChange={(e) => cambiar('fechaHasta', e.target.value)}
          />
        </div>
      </div>
      {rangoInvalido(filtros) && (
        <p role="alert" className="text-sm text-red-600">
          La fecha "hasta" no puede ser anterior a la fecha "desde".
        </p>
      )}
    </div>
  );
}
