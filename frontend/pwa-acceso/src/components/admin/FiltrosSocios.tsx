import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BUSCAR_MAX,
  ETIQUETA_ESTADO,
  type EstadoSocio,
  type FiltrosSocios as Filtros,
} from '@/lib/socios';

const CLASE_SELECT =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const ESTADOS: EstadoSocio[] = ['vigente', 'vencida', 'baja'];

interface Props {
  filtros: Filtros;
  onCambiar: (filtros: Filtros) => void;
}

/** Buscador por DNI o nombre y filtro por estado de la membresía. */
export default function FiltrosSocios({ filtros, onCambiar }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
      <div>
        <Label htmlFor="socios-buscar">Buscar por DNI o nombre</Label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            id="socios-buscar"
            type="search"
            className="pl-9"
            placeholder="Ej.: 30111222 o Pérez"
            maxLength={BUSCAR_MAX}
            value={filtros.buscar}
            onChange={(e) => onCambiar({ ...filtros, buscar: e.target.value })}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="socios-estado">Estado de la membresía</Label>
        <select
          id="socios-estado"
          className={`${CLASE_SELECT} mt-1`}
          value={filtros.estado}
          onChange={(e) =>
            onCambiar({
              ...filtros,
              estado: e.target.value as EstadoSocio | '',
            })
          }
        >
          <option value="">Todos</option>
          {ESTADOS.map((estado) => (
            <option key={estado} value={estado}>
              {ETIQUETA_ESTADO[estado]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
