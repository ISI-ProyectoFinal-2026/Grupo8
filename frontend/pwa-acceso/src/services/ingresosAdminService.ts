import { TAMANIO_PAGINA, type TipoCliente } from '@/lib/reservasAdmin';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export type TipoIngreso = 'web' | 'manual';

/** Una fila del historial de ingresos del panel (GET /api/v1/admin/ingresos). */
export interface IngresoAdmin {
  id: string;
  /** Instante en UTC (ISO 8601). La pantalla lo muestra en hora de Buenos Aires. */
  fecha_hora_ingreso: string;
  /** null en los ingresos manuales. */
  reserva_id: string | null;
  personas: number;
  tipo_cliente: TipoCliente;
  tipo_ingreso: TipoIngreso;
}

export interface IngresosPaginados {
  desde: string; // AAAA-MM-DD, día de Buenos Aires
  hasta: string;
  total: number;
  items: IngresoAdmin[];
}

export interface ConsultaIngresos {
  desde: string;
  hasta: string;
  /** Página, empezando en 0. */
  pagina: number;
}

export class IngresosApiError extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'IngresosApiError';
    this.status = status;
  }
}

export async function obtenerHistorialIngresos(
  token: string | null,
  { desde, hasta, pagina }: ConsultaIngresos,
  signal?: AbortSignal
): Promise<IngresosPaginados> {
  const params = new URLSearchParams({
    desde,
    hasta,
    skip: String(pagina * TAMANIO_PAGINA),
    limit: String(TAMANIO_PAGINA),
  });
  const response = await fetch(`${API_URL}/api/v1/admin/ingresos?${params}`, {
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
    throw new IngresosApiError(response.status, mensaje);
  }
  return (await response.json()) as IngresosPaginados;
}

export function mensajeDeError(error: unknown): string {
  if (error instanceof IngresosApiError) {
    if (error.status === 401)
      return 'Tu sesión venció. Volvé a iniciar sesión.';
    if (error.status === 403)
      return 'No tenés permisos para ver el historial de ingresos.';
    return error.message;
  }
  if (error instanceof TypeError) return 'No se pudo conectar con el servidor.';
  return 'Ocurrió un error inesperado.';
}
