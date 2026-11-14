const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface Ocupacion {
  ocupacion_actual: number;
  capacidad_maxima: number;
  /** Lugares que no se venden online y quedan para los ingresos en la puerta (en personas). */
  buffer_offline: number;
}

/** Reservas web que se esperan hoy y todavía no ingresaron. */
export interface Esperados {
  reservas: number;
  personas: number;
}

export interface Egreso {
  id: string;
  cantidad_personas: number;
  fecha_hora_egreso: string; // ISO con zona
  registrado_por_id: string;
  personas_dentro: number;
}

export class OcupacionApiError extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'OcupacionApiError';
    this.status = status;
  }
}

const cabeceras = (token: string | null): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function leerError(response: Response): Promise<OcupacionApiError> {
  let mensaje = `Error ${response.status}`;
  try {
    const cuerpo = (await response.json()) as { detail?: unknown };
    if (typeof cuerpo.detail === 'string') mensaje = cuerpo.detail;
    // Los errores de validación de FastAPI llegan como lista
    else if (Array.isArray(cuerpo.detail)) mensaje = 'Revisá los datos ingresados.';
  } catch {
    // la respuesta no trae cuerpo JSON
  }
  return new OcupacionApiError(response.status, mensaje);
}

export async function obtenerOcupacion(
  token: string | null,
  signal?: AbortSignal
): Promise<Ocupacion> {
  const response = await fetch(`${API_URL}/api/v1/ocupacion`, {
    headers: cabeceras(token),
    signal,
  });
  if (!response.ok) throw await leerError(response);
  return (await response.json()) as Ocupacion;
}

export async function obtenerEsperados(
  token: string | null,
  signal?: AbortSignal
): Promise<Esperados> {
  const response = await fetch(`${API_URL}/api/v1/admin/esperados`, {
    headers: cabeceras(token),
    signal,
  });
  if (!response.ok) throw await leerError(response);
  return (await response.json()) as Esperados;
}

export async function registrarEgreso(
  token: string | null,
  cantidadPersonas: number
): Promise<Egreso> {
  // Sin fecha y hora: el backend toma la del momento en que llega el pedido
  const response = await fetch(`${API_URL}/api/v1/egresos`, {
    method: 'POST',
    headers: cabeceras(token),
    body: JSON.stringify({ cantidad_personas: cantidadPersonas }),
  });
  if (!response.ok) throw await leerError(response);
  return (await response.json()) as Egreso;
}

export function mensajeDeError(error: unknown): string {
  if (error instanceof OcupacionApiError) {
    if (error.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
    if (error.status === 403) return 'No tenés permisos para ver la ocupación ni registrar egresos.';
    return error.message;
  }
  if (error instanceof TypeError) return 'No se pudo conectar con el servidor.';
  return 'Ocurrió un error inesperado.';
}