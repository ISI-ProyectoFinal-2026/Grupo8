const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const BASE = `${API_URL}/api/v1/admin/alertas`;

export interface AlertaClonacion {
  reserva_id: string;
  titular: string;
  fecha_ingreso: string; // YYYY-MM-DD
  fecha_alerta_clonacion: string | null; // ISO con zona
}

export interface ResolucionAlerta {
  reserva_id: string;
  estado_restaurado: string;
  resuelto_por_id: string;
  resuelto_por_nombre: string;
  fecha_resolucion: string;
}

export class AlertasApiError extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'AlertasApiError';
    this.status = status;
  }
}

const cabeceras = (token: string | null): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function leerError(response: Response): Promise<AlertasApiError> {
  let mensaje = `Error ${response.status}`;
  try {
    const cuerpo = (await response.json()) as { detail?: unknown };
    if (typeof cuerpo.detail === 'string') mensaje = cuerpo.detail;
  } catch {
    // la respuesta no trae cuerpo JSON
  }
  return new AlertasApiError(response.status, mensaje);
}

export async function listarAlertas(
  token: string | null,
  signal?: AbortSignal
): Promise<AlertaClonacion[]> {
  const response = await fetch(BASE, { headers: cabeceras(token), signal });
  if (!response.ok) throw await leerError(response);
  return (await response.json()) as AlertaClonacion[];
}

export async function resolverAlerta(
  token: string | null,
  reservaId: string,
  nota: string
): Promise<ResolucionAlerta> {
  const response = await fetch(`${BASE}/${encodeURIComponent(reservaId)}/resolver`, {
    method: 'POST',
    headers: cabeceras(token),
    body: JSON.stringify({ nota: nota.trim() === '' ? null : nota.trim() }),
  });
  if (!response.ok) throw await leerError(response);
  return (await response.json()) as ResolucionAlerta;
}

export function mensajeDeError(error: unknown): string {
  if (error instanceof AlertasApiError) {
    if (error.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
    if (error.status === 403) return 'No tenés permisos para ver o resolver alertas.';
    return error.message;
  }
  if (error instanceof TypeError) return 'No se pudo conectar con el servidor.';
  return 'Ocurrió un error inesperado.';
}