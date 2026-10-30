import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  AlertasApiError,
  listarAlertas,
  mensajeDeError,
  resolverAlerta,
  type AlertaClonacion,
} from '@/services/alertasService';

export type EstadoAlertas = 'cargando' | 'error' | 'vacio' | 'listo';

interface UseAlertas {
  alertas: AlertaClonacion[];
  estado: EstadoAlertas;
  error: string | null;
  actualizando: boolean;
  recargar: () => Promise<void>;
  resolver: (reservaId: string, nota: string) => Promise<void>;
}

export function useAlertas(): UseAlertas {
  const { token } = useAuth();
  // null significa que todavía no se cargó nunca: solo ahí se muestra el "cargando" de pantalla completa
  const [datos, setDatos] = useState<AlertaClonacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const peticion = useRef<AbortController | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    // Si había una petición en curso se cancela, para que una respuesta lenta no pise a la nueva
    peticion.current?.abort();
    const control = new AbortController();
    peticion.current = control;
    setActualizando(true);
    try {
      const alertas = await listarAlertas(token, control.signal);
      if (control.signal.aborted) return;
      setDatos(alertas);
      setError(null);
    } catch (e) {
      if (control.signal.aborted) return;
      setError(mensajeDeError(e));
    } finally {
      if (!control.signal.aborted) setActualizando(false);
    }
  }, [token]);

  useEffect(() => {
    void recargar();
    return () => peticion.current?.abort();
  }, [recargar]);

  const resolver = useCallback(
    async (reservaId: string, nota: string): Promise<void> => {
      try {
        await resolverAlerta(token, reservaId, nota);
      } catch (e) {
        // Otro administrador ya la resolvió: se actualiza el listado y se avisa desde la pantalla
        if (e instanceof AlertasApiError && e.status === 409) await recargar();
        throw e;
      }
      await recargar();
    },
    [token, recargar]
  );

  let estado: EstadoAlertas;
  if (datos === null) estado = error ? 'error' : 'cargando';
  else estado = datos.length === 0 ? 'vacio' : 'listo';

  return { alertas: datos ?? [], estado, error, actualizando, recargar, resolver };
}