import { useCallback, useEffect, useRef, useState } from 'react';
import { sincronizarBootstrap } from '../services/bootstrapService';
import { dbService } from '../services/dbService';

export type EstadoCapacidad = 'cargando' | 'disponible' | 'sin_dato';

interface UseCapacidad {
  /** null significa "desconocida": nunca se reemplaza por un valor inventado */
  capacidadMaxima: number | null;
  estado: EstadoCapacidad;
}

export function useCapacidad(): UseCapacidad {
  const [capacidadMaxima, setCapacidadMaxima] = useState<number | null>(null);
  const [leyendoLocal, setLeyendoLocal] = useState(true);
  const [primerIntentoTerminado, setPrimerIntentoTerminado] = useState(false);
  const montado = useRef(true);

  const actualizarDesdeServidor = useCallback(async (): Promise<void> => {
    const descargada = await sincronizarBootstrap();
    if (!montado.current) return;
    if (descargada !== null) setCapacidadMaxima(descargada);
    setPrimerIntentoTerminado(true);
  }, []);

  useEffect(() => {
    montado.current = true;

    const iniciar = async (): Promise<void> => {
      // 1. Primero lo guardado: es instantáneo y permite mostrar la pantalla sin esperar a la red
      try {
        const local = await dbService.obtenerCapacidadMaxima();
        if (montado.current && local !== null) setCapacidadMaxima(local);
      } catch (error) {
        console.error('No se pudo leer la capacidad guardada:', error);
      } finally {
        if (montado.current) setLeyendoLocal(false);
      }
      // 2. Después se intenta refrescar desde el servidor, sin bloquear nada
      await actualizarDesdeServidor();
    };
    void iniciar();

    const alVolverLaRed = () => void actualizarDesdeServidor();
    window.addEventListener('online', alVolverLaRed);
    return () => {
      montado.current = false;
      window.removeEventListener('online', alVolverLaRed);
    };
  }, [actualizarDesdeServidor]);

  let estado: EstadoCapacidad;
  if (capacidadMaxima !== null) estado = 'disponible';
  else if (leyendoLocal || !primerIntentoTerminado) estado = 'cargando';
  else estado = 'sin_dato';

  return { capacidadMaxima, estado };
}