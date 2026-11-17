import type { CondicionesCancelacion, ResultadoCancelacion } from '@/lib/misReservas';

/**
 * Botón de arrepentimiento (25.3): se usa sin sesión. Por eso no reutiliza las llamadas de
 * Mis reservas, que ante un 401 cierran la sesión: acá un 401 es un enlace vencido o no válido.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

/** Lo que responde POST /arrepentimiento/solicitud, haya o no reservas con ese email. */
export const MENSAJE_SOLICITUD =
  'Si hay reservas con ese email, te enviamos un correo con un enlace para cada una.';

const SIN_CONEXION = 'No se pudo conectar con el servidor. Intentá nuevamente.';

/** Respuesta de POST /arrepentimiento/confirmar: la de Mis reservas más el código de gestión. */
export interface ResultadoArrepentimiento extends ResultadoCancelacion {
  codigo_gestion: string;
}

export class ErrorArrepentimiento extends Error {
  /** 0 sin conexión; 401 enlace vencido o no válido; 422 no se puede cancelar. */
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function revisarRespuesta(respuesta: Response, porDefecto: string): Promise<void> {
  if (respuesta.ok) return;
  let mensaje = porDefecto;
  // En 401 y 422 el backend explica el motivo ("El enlace venció…", "Lo sentimos…")
  if (respuesta.status === 401 || respuesta.status === 422) {
    try {
      const cuerpo = await respuesta.json();
      if (typeof cuerpo?.detail === 'string') mensaje = cuerpo.detail;
    } catch {
      // La respuesta no era JSON: queda el mensaje genérico
    }
  }
  throw new ErrorArrepentimiento(mensaje, respuesta.status);
}

async function pedir(url: string, opciones: RequestInit): Promise<Response> {
  try {
    return await fetch(url, opciones);
  } catch (e) {
    if (opciones.signal?.aborted) throw e;
    throw new ErrorArrepentimiento(SIN_CONEXION, 0);
  }
}

/** Pide que se manden los enlaces al email. */
export async function solicitarEnlaces(email: string): Promise<void> {
  const respuesta = await pedir(`${API_URL}/arrepentimiento/solicitud`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim() }),
  });
  await revisarRespuesta(respuesta, 'No pudimos enviar el correo. Intentá nuevamente.');
}

/** Condiciones de cancelación de la reserva del enlace. */
export async function obtenerCondicionesPorEnlace(
  token: string,
  signal?: AbortSignal
): Promise<CondicionesCancelacion> {
  const respuesta = await pedir(
    `${API_URL}/arrepentimiento/condiciones?${new URLSearchParams({ token })}`,
    { signal }
  );
  await revisarRespuesta(
    respuesta,
    'No pudimos consultar las condiciones de cancelación. Intentá nuevamente.'
  );
  return (await respuesta.json()) as CondicionesCancelacion;
}

/** Cancela la reserva del enlace. */
export async function confirmarArrepentimiento(token: string): Promise<ResultadoArrepentimiento> {
  const respuesta = await pedir(`${API_URL}/arrepentimiento/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  await revisarRespuesta(respuesta, 'No pudimos cancelar la reserva. Intentá nuevamente.');
  return (await respuesta.json()) as ResultadoArrepentimiento;
}
