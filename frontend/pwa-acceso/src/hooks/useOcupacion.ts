import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import {
  mensajeDeError,
  obtenerOcupacion,
  OcupacionApiError,
  type Ocupacion,
} from '@/services/ocupacionService';

/** Cada cuánto se vuelve a consultar la ocupación mientras la pantalla está abierta. */
export const INTERVALO_ACTUALIZACION_MS = 30_000;

export type EstadoOcupacion = 'cargando' | 'error' | 'vacio' | 'listo';

export interface UseOcupacion {
  ocupacion: Ocupacion | null;
  estado: EstadoOcupacion;
  error: string | null;
  recargar: () => Promise<void>;
}

export function useOcupacion(): UseOcupacion {
  const { token } = useAuth();
  // null significa que todavía no se cargó nunca: solo ahí se muestra el "cargando"
  const [ocupacion, setOcupacion] = useState<Ocupacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const peticion = useRef<AbortController | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    // Si había una petición en curso se cancela, para que una respuesta lenta no pise a la nueva
    peticion.current?.abort();
    const control = new AbortController();
    peticion.current = control;
    try {
      const datos = await obtenerOcupacion(token, control.signal);
      if (control.signal.aborted) return;
      setOcupacion(datos);
      setError(null);
    } catch (e) {
      if (control.signal.aborted) return;
      // Una sesión vencida cierra la sesión desde el AuthContext
      if (e instanceof OcupacionApiError && e.status === 401) {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
      setError(mensajeDeError(e));
    }
  }, [token]);

  useEffect(() => {
    void recargar();
    const intervalo = window.setInterval(() => void recargar(), INTERVALO_ACTUALIZACION_MS);
    return () => {
      window.clearInterval(intervalo);
      peticion.current?.abort();
    };
  }, [recargar]);

  let estado: EstadoOcupacion;
  if (ocupacion === null) estado = error ? 'error' : 'cargando';
  else estado = ocupacion.ocupacion_actual === 0 ? 'vacio' : 'listo';

  return { ocupacion, estado, error, recargar };
}