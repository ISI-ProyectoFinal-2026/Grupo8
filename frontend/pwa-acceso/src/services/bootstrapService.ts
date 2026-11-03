import { dbService } from './dbService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const TIEMPO_MAXIMO_MS = 8000;

interface RespuestaBootstrap {
  configuracion?: { capacidad_maxima?: unknown };
}

const esCapacidadValida = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isInteger(valor) && valor > 0;

/**
 * Descarga la capacidad máxima del servidor y la guarda en IndexedDB.
 * Devuelve la capacidad descargada, o null si no se pudo (sin red, error del servidor
 * o una respuesta inválida). Nunca lanza: la app tiene que seguir funcionando sin red.
 */
export async function sincronizarBootstrap(): Promise<number | null> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  try {
    // La blacklist del endpoint todavía no se usa (ver docs/pwa-bootstrap-y-blacklist.md),
    // así que se pide una sola página de un elemento para no descargarla de más
    const response = await fetch(`${API_URL}/api/v1/sincronizacion/bootstrap?page=1&limit=1`, {
      signal: control.signal,
    });
    if (!response.ok) throw new Error(`Falla HTTP: ${response.status}`);

    const data = (await response.json()) as RespuestaBootstrap;
    const capacidad = data.configuracion?.capacidad_maxima;
    if (!esCapacidadValida(capacidad)) {
      throw new Error('El bootstrap no trajo una capacidad válida.');
    }

    await dbService.guardarCapacidadMaxima(capacidad);
    return capacidad;
  } catch (error) {
    console.warn('[Bootstrap] No se pudo descargar la capacidad:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}