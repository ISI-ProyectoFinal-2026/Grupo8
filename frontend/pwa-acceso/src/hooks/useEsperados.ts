import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT, useAuth } from '@/context/AuthContext';
import { INTERVALO_ACTUALIZACION_MS } from '@/hooks/useOcupacion';
import {
  mensajeDeError,
  obtenerEsperados,
  OcupacionApiError,
  type Esperados,
} from '@/services/ocupacionService';

export type EstadoEsperados = 'cargando' | 'error' | 'listo';

export interface UseEsperados {
  esperados: Esperados | null;
  estado: EstadoEsperados;
  error: string | null;
  recargar: () => Promise<void>;
}

/**
 * Personas que se esperan hoy por reservas web. Se actualiza al mismo ritmo que el monitor
 * de ocupación, así una reserva que ingresa deja de aparecer sin recargar la página.
 */
export function useEsperados(): UseEsperados {
  const { token } = useAuth();
  // null significa que todavía no se cargó nunca: solo ahí se muestra el "cargando"
  const [esperados, setEsperados] = useState<Esperados | null>(null);
  const [error, setError] = useState<string | null>(null);
  const peticion = useRef<AbortController | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    // Una respuesta lenta no debe pisar a la más nueva
    peticion.current?.abort();
    const control = new AbortController();
    peticion.current = control;
    try {
      const datos = await obtenerEsperados(token, control.signal);
      if (control.signal.aborted) return;
      setEsperados(datos);
      setError(null);
    } catch (e) {
      if (control.signal.aborted) return;
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

  let estado: EstadoEsperados;
  if (esperados === null) estado = error ? 'error' : 'cargando';
  else estado = 'listo';

  return { esperados, estado, error, recargar };
}
