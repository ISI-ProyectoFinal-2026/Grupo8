import { Button } from '@/components/ui/button';
import { formatearFecha } from '@/lib/fechas';
import type { ResultadoDisponibilidad } from '@/lib/disponibilidad';

function lugares(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'lugar' : 'lugares'}`;
}

interface Props {
  disponibilidad: ResultadoDisponibilidad;
  /** Día elegido en el formulario (AAAA-MM-DD). */
  fechaElegida: string;
  /** Personas de la reserva, si ya se escribieron: se compara con los lugares de la estadía. */
  personas: number | null;
  onElegir: (fecha: string) => void;
}

/**
 * Lista del día elegido y los siguientes con los lugares ocupados y libres de cada uno. Los días
 * completos dicen "Completo" con texto y no se pueden elegir. Los números vienen del backend.
 */
export function DisponibilidadDias({ disponibilidad, fechaElegida, personas, onElegir }: Props) {
  const { estado, datos, reintentar } = disponibilidad;
  if (estado === 'inactivo') return null;

  return (
    <section
      aria-labelledby="titulo-disponibilidad"
      aria-busy={estado === 'cargando'}
      className="space-y-3 rounded-lg border border-tierra-200 bg-tierra-50 p-4"
    >
      <h2 id="titulo-disponibilidad" className="text-base font-semibold text-tierra-900">
        Lugares disponibles
      </h2>

      {estado === 'cargando' && (
        <p role="status" className="text-sm text-tierra-600">
          Consultando la disponibilidad…
        </p>
      )}

      {estado === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            No pudimos consultar la disponibilidad. Podés continuar: el cupo se confirma al reservar.
          </p>
          <Button type="button" variant="outline" onClick={reintentar}>
            Reintentar
          </Button>
        </div>
      )}

      {estado === 'listo' && datos && (
        <>
          <ul className="grid gap-2">
            {datos.dias.map((dia) => {
              const elegido = dia.fecha === fechaElegida;
              return (
                <li key={dia.fecha}>
                  <button
                    type="button"
                    disabled={dia.completo}
                    aria-pressed={elegido}
                    onClick={() => onElegir(dia.fecha)}
                    className={`flex min-h-11 w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-left text-sm text-tierra-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-tierra-100 disabled:text-tierra-700 ${
                      elegido ? 'border-bosque-600 bg-bosque-50 font-semibold' : 'border-tierra-300 bg-white'
                    }`}
                  >
                    <span>
                      {formatearFecha(dia.fecha)}
                      {elegido && <span className="sr-only"> (día elegido)</span>}
                    </span>
                    <span>
                      {dia.completo ? (
                        <strong>Completo</strong>
                      ) : (
                        <>
                          <strong>{lugares(dia.disponibles)} libres</strong> de {datos.cupo_maximo}
                        </>
                      )}
                      <span className="text-tierra-700"> · {dia.ocupados} ocupados</span>
                      {dia.completo && <span className="sr-only"> (no se puede elegir)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {datos.estadia && (
            <p role="status" className="text-sm text-tierra-900">
              Para tu estadía del {formatearFecha(datos.estadia.ingreso)} al{' '}
              {formatearFecha(datos.estadia.egreso)} quedan{' '}
              <strong>{lugares(datos.estadia.disponibles)}</strong>.
              {personas !== null && personas > datos.estadia.disponibles && (
                <>
                  {' '}
                  <strong>Con {personas} {personas === 1 ? 'persona' : 'personas'} no alcanza: elegí otras fechas o menos personas.</strong>
                </>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
