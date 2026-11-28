// Cupo de la web de reservas: cuántos lugares (personas) hay ocupados y libres cada día.
// Lo calcula el backend con la misma regla que usa al crear la reserva; acá solo se muestra.
import { useEffect, useState } from 'react';
import { ErrorApi } from '@/lib/descuentos';
import { hoyISO } from '@/lib/validaciones';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

/** Cuántos días muestra la lista: el elegido y los siguientes. */
export const DIAS_MOSTRADOS = 7;

export interface LugaresDisponibles {
  ocupados: number;
  disponibles: number;
  completo: boolean;
}

export interface DiaDisponibilidad extends LugaresDisponibles {
  fecha: string;
}

export interface EstadiaDisponibilidad extends LugaresDisponibles {
  ingreso: string;
  egreso: string;
}

/** Lo que devuelve GET /disponibilidad. */
export interface Disponibilidad {
  cupo_maximo: number;
  dias: DiaDisponibilidad[];
  estadia: EstadiaDisponibilidad | null;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function obtenerDisponibilidad(
  desde: string,
  egreso: string | null,
  signal?: AbortSignal
): Promise<Disponibilidad> {
  const params = new URLSearchParams({ desde, dias: String(DIAS_MOSTRADOS) });
  if (egreso) params.set('egreso', egreso);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/disponibilidad?${params}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ErrorApi('No se pudo conectar con el servidor.', 0);
  }
  if (!response.ok)
    throw new ErrorApi('No se pudo consultar la disponibilidad.', response.status);
  const datos = (await response.json()) as Disponibilidad;
  if (!Array.isArray(datos?.dias))
    throw new ErrorApi('La respuesta de disponibilidad no es válida.', response.status);
  return datos;
}

export type EstadoDisponibilidad = 'inactivo' | 'cargando' | 'error' | 'listo';

export interface ResultadoDisponibilidad {
  estado: EstadoDisponibilidad;
  /** Solo hay datos si corresponden a la fecha y estadía actuales: nunca los de una consulta anterior. */
  datos: Disponibilidad | null;
  reintentar: () => void;
}

interface Respuesta {
  clave: string;
  datos: Disponibilidad | null;
}

/**
 * Consulta la disponibilidad de `desde` y los días siguientes (y de la estadía hasta `egreso`, si
 * se indica). Cuando cambia la fecha se vuelve a consultar y, hasta que llega la respuesta nueva,
 * no se muestra nada de la anterior. Si la consulta falla tampoco queda ningún dato.
 */
export function useDisponibilidad(
  desde: string,
  egreso: string | null
): ResultadoDisponibilidad {
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [intento, setIntento] = useState(0);

  // Con la fecha incompleta o ya pasada no se consulta
  const activo = FECHA_ISO.test(desde) && desde >= hoyISO();
  const clave = activo ? `${desde}|${egreso ?? ''}|${intento}` : '';

  useEffect(() => {
    if (!activo) return;
    const controlador = new AbortController();
    obtenerDisponibilidad(desde, egreso, controlador.signal)
      .then((datos) => {
        // Una respuesta vieja que llega tarde no pisa la de la fecha actual
        if (!controlador.signal.aborted) setRespuesta({ clave, datos });
      })
      .catch(() => {
        if (!controlador.signal.aborted) setRespuesta({ clave, datos: null });
      });
    return () => controlador.abort();
  }, [activo, desde, egreso, clave]);

  const reintentar = () => setIntento((n) => n + 1);

  if (!activo) return { estado: 'inactivo', datos: null, reintentar };
  if (respuesta?.clave !== clave) return { estado: 'cargando', datos: null, reintentar };
  if (!respuesta.datos) return { estado: 'error', datos: null, reintentar };
  return { estado: 'listo', datos: respuesta.datos, reintentar };
}
