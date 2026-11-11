import { AUTH_EXPIRED_EVENT, TOKEN_KEY } from '@/context/AuthContext';
import { dbService } from './dbService';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const TIEMPO_MAXIMO_MS = 8000;
// El backend acepta hasta 1000 por página
const TAMANIO_PAGINA = 1000;
// Freno por si el servidor nunca dice que terminó: 100 páginas son 100.000 reservas
const MAXIMO_PAGINAS = 100;

interface RespuestaBootstrap {
  blacklist?: unknown;
  configuracion?: { capacidad_maxima?: unknown };
  tiene_mas_paginas?: unknown;
}

const esCapacidadValida = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isInteger(valor) && valor > 0;

const esListaDeIds = (valor: unknown): valor is string[] =>
  Array.isArray(valor) &&
  valor.every((id) => typeof id === 'string' && id.length > 0);

const leerToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

async function pedirPagina(pagina: number): Promise<RespuestaBootstrap> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  const token = leerToken();
  try {
    const response = await fetch(
      `${API_URL}/api/v1/sincronizacion/bootstrap?page=${pagina}&limit=${TAMANIO_PAGINA}`,
      {
        signal: control.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    );
    // Con 401 la sesión ya no vale (vencida o usuario dado de baja): se pide un nuevo login
    if (response.status === 401)
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    if (!response.ok) throw new Error(`Falla HTTP: ${response.status}`);
    return (await response.json()) as RespuestaBootstrap;
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Descarga todas las páginas de reservas canceladas a partir de la primera.
 * Devuelve la lista completa, o null si alguna página falló o vino mal:
 * una lista a medias no reemplaza a la que ya estaba guardada.
 */
async function descargarBlacklist(
  primera: RespuestaBootstrap
): Promise<string[] | null> {
  const ids: string[] = [];
  let pagina = primera;
  for (let numero = 1; ; numero++) {
    if (!esListaDeIds(pagina.blacklist)) {
      console.warn(
        '[Bootstrap] La lista de reservas canceladas vino con un formato inválido.'
      );
      return null;
    }
    ids.push(...pagina.blacklist);
    if (pagina.tiene_mas_paginas !== true) return ids;
    if (numero >= MAXIMO_PAGINAS) {
      console.warn(
        '[Bootstrap] La lista de reservas canceladas superó el máximo de páginas.'
      );
      return null;
    }
    pagina = await pedirPagina(numero + 1);
  }
}

/**
 * Sincroniza la PWA con el servidor: guarda la capacidad máxima y reemplaza la lista local
 * de reservas canceladas, que es la que permite rechazar sus QR sin conexión.
 *
 * Devuelve la capacidad descargada, o null si no se pudo (sin red, error del servidor
 * o una respuesta inválida). Nunca lanza: la app tiene que seguir funcionando sin red.
 * Si algo falla, se siguen usando la capacidad y la lista que ya estaban guardadas.
 */
export async function sincronizarBootstrap(): Promise<number | null> {
  let primera: RespuestaBootstrap;
  try {
    primera = await pedirPagina(1);
  } catch (error) {
    console.warn(
      '[Bootstrap] No se pudo descargar el bootstrap:',
      error instanceof Error ? error.message : error
    );
    return null;
  }

  // La capacidad y la lista se guardan por separado: un problema en una no frena a la otra
  let capacidad: number | null = null;
  try {
    const valor = primera.configuracion?.capacidad_maxima;
    if (!esCapacidadValida(valor))
      throw new Error('El bootstrap no trajo una capacidad válida.');
    await dbService.guardarCapacidadMaxima(valor);
    capacidad = valor;
  } catch (error) {
    console.warn(
      '[Bootstrap] No se pudo guardar la capacidad:',
      error instanceof Error ? error.message : error
    );
  }

  try {
    const ids = await descargarBlacklist(primera);
    if (ids !== null) await dbService.reemplazarBlacklist(ids);
  } catch (error) {
    console.warn(
      '[Bootstrap] No se pudo actualizar la lista de reservas canceladas:',
      error instanceof Error ? error.message : error
    );
  }

  return capacidad;
}
