const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface CobrosDia {
  fecha: string; // AAAA-MM-DD, día de Buenos Aires
  efectivo: number;
  mercado_pago: number;
  total: number;
}

export interface ResumenCobros {
  desde: string;
  hasta: string;
  total_efectivo: number;
  total_mercado_pago: number;
  total: number;
  dias: CobrosDia[];
}

export class CobrosApiError extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'CobrosApiError';
    this.status = status;
  }
}

export async function obtenerResumenCobros(
  token: string | null,
  desde: string,
  hasta: string,
  signal?: AbortSignal
): Promise<ResumenCobros> {
  const params = new URLSearchParams({ desde, hasta });
  const response = await fetch(`${API_URL}/api/v1/admin/cobros?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });

  if (!response.ok) {
    let mensaje = `Error ${response.status}`;
    try {
      const cuerpo = (await response.json()) as { detail?: unknown };
      if (typeof cuerpo.detail === 'string') mensaje = cuerpo.detail;
    } catch {
      // la respuesta no trae cuerpo JSON
    }
    throw new CobrosApiError(response.status, mensaje);
  }
  return (await response.json()) as ResumenCobros;
}

export function mensajeDeError(error: unknown): string {
  if (error instanceof CobrosApiError) {
    if (error.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
    if (error.status === 403) return 'No tenés permisos para ver los cobros.';
    return error.message;
  }
  if (error instanceof TypeError) return 'No se pudo conectar con el servidor.';
  return 'Ocurrió un error inesperado.';
}
