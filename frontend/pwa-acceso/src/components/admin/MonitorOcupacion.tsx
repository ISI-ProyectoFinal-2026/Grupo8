import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { UseOcupacion } from '@/hooks/useOcupacion';
import {
  nivelOcupacion,
  porcentajeBuffer,
  porcentajeOcupacion,
  type NivelOcupacion,
} from '@/lib/ocupacion';
import { cn } from '@/lib/utils';

const COLOR_BARRA: Record<NivelOcupacion, string> = {
  verde: 'bg-green-500',
  amarillo: 'bg-yellow-400',
  rojo: 'bg-red-500',
};

const COLOR_TEXTO: Record<NivelOcupacion, string> = {
  verde: 'text-green-700',
  amarillo: 'text-yellow-700',
  rojo: 'text-red-700',
};

// El color no es la única señal: el nivel también se lee en texto
const TEXTO_NIVEL: Record<NivelOcupacion, string> = {
  verde: 'Ocupación normal',
  amarillo: 'Ocupación alta',
  rojo: 'Ocupación crítica',
};

const personas = (cantidad: number) => (cantidad === 1 ? '1 persona' : `${cantidad} personas`);
const lugares = (cantidad: number) => (cantidad === 1 ? '1 lugar' : `${cantidad} lugares`);

type MonitorOcupacionProps = Pick<UseOcupacion, 'ocupacion' | 'estado' | 'error' | 'recargar'>;

export function MonitorOcupacion({ ocupacion, estado, error, recargar }: MonitorOcupacionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ocupación del camping</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {estado === 'cargando' && (
          <p role="status" className="text-zinc-600">
            Cargando ocupación…
          </p>
        )}

        {estado === 'error' && (
          <div role="alert" className="space-y-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{`No se pudo consultar la ocupación. ${error ?? ''}`}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void recargar()}>
              Reintentar
            </Button>
          </div>
        )}

        {ocupacion && <Barra ocupacion={ocupacion} />}

        {estado === 'vacio' && (
          <p role="status" className="text-sm text-zinc-600">
            No hay personas dentro del camping.
          </p>
        )}

        {/* Si ya había datos y falla una actualización, se siguen mostrando los últimos */}
        {ocupacion && error && (
          <p role="alert" className="text-sm text-red-600">
            {`No se pudo actualizar la ocupación: ${error}`}
          </p>
        )}

        <p className="text-xs text-zinc-500">
          Se actualiza cada 30 segundos. Los ingresos que los guardias registran sin conexión se
          suman cuando sincronizan, así que el valor puede ir atrasado.
        </p>
      </CardContent>
    </Card>
  );
}

function Barra({ ocupacion }: { ocupacion: NonNullable<UseOcupacion['ocupacion']> }) {
  const { ocupacion_actual: actual, capacidad_maxima: capacidad, buffer_offline: buffer } = ocupacion;
  const porcentaje = porcentajeOcupacion(actual, capacidad);
  const nivel = nivelOcupacion(porcentaje);
  const anchoBuffer = porcentajeBuffer(buffer, capacidad);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-3xl font-bold text-zinc-900">
          {actual} <span className="text-lg font-medium text-zinc-500">{`/ ${capacidad} personas`}</span>
        </p>
        <p className={cn('text-lg font-semibold', COLOR_TEXTO[nivel])}>
          {`${porcentaje} %`} <span className="text-sm font-medium">· {TEXTO_NIVEL[nivel]}</span>
        </p>
      </div>

      <div
        role="progressbar"
        aria-label="Ocupación del camping"
        aria-valuemin={0}
        aria-valuemax={capacidad}
        aria-valuenow={actual}
        aria-valuetext={`${personas(actual)} de ${capacidad} (${porcentaje} %)`}
        data-nivel={nivel}
        className="relative h-5 w-full overflow-hidden rounded-full bg-zinc-200"
      >
        <div
          className={cn('h-full transition-all', COLOR_BARRA[nivel])}
          style={{ width: `${Math.min(porcentaje, 100)}%` }}
        />
        {anchoBuffer > 0 && (
          // Tramo final de la barra: lugares que no se venden online
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 border-l-2 border-dashed border-zinc-600 bg-zinc-500/20"
            style={{ width: `${anchoBuffer}%` }}
          />
        )}
      </div>

      <p className="text-sm text-zinc-600">
        {`Buffer offline: ${lugares(buffer)} reservados para ingresos en la puerta (tramo rayado de la barra).`}
      </p>
    </div>
  );
}