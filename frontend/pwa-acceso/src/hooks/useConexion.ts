import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dbService } from '@/services/dbService';

/** Estados que emite syncService en el evento `sync-status`. */
type EstadoSync = 'iniciando' | 'reintentando' | 'completado' | 'error';

export interface EstadoConexion {
  /** El navegador dice que hay red (`navigator.onLine`). */
  enLinea: boolean;
  /**
   * Ingresos que todavía no llegaron al servidor.
   * `undefined` mientras se hace la primera lectura y `null` si IndexedDB no respondió.
   */
  pendientes: number | null | undefined;
  /** Hay un envío a bulk-sync en curso (o reintentándose). */
  sincronizando: boolean;
}

/**
 * Estado de conexión de la PWA del guardia: si hay red, cuántos ingresos faltan
 * sincronizar y si hay una sincronización en curso.
 *
 * El conteo usa `useLiveQuery`: Dexie vuelve a ejecutar la consulta cada vez que cambia
 * `ingresos_pendientes`, sin importar quién la cambió (un escaneo, un ingreso manual o
 * syncService al borrar los confirmados). Así no hace falta avisar a mano desde cada pantalla.
 */
export function useConexion(): EstadoConexion {
  const [enLinea, setEnLinea] = useState<boolean>(() => navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);

  const pendientes = useLiveQuery(
    () => dbService.contarIngresosPendientes().catch(() => null),
    []
  );

  useEffect(() => {
    const alCambiarRed = () => {
      setEnLinea(navigator.onLine);
      // Sin red no puede haber un envío en curso; si vuelve, syncService avisa de nuevo
      if (!navigator.onLine) setSincronizando(false);
    };

    const alCambiarSync = (evento: Event) => {
      const estado = (evento as CustomEvent<{ estado: EstadoSync }>).detail
        ?.estado;
      setSincronizando(estado === 'iniciando' || estado === 'reintentando');
    };

    window.addEventListener('online', alCambiarRed);
    window.addEventListener('offline', alCambiarRed);
    window.addEventListener('sync-status', alCambiarSync);
    return () => {
      window.removeEventListener('online', alCambiarRed);
      window.removeEventListener('offline', alCambiarRed);
      window.removeEventListener('sync-status', alCambiarSync);
    };
  }, []);

  return { enLinea, pendientes, sincronizando };
}
