// Estado real del pago al volver de Mercado Pago (/pago/exito), sin sesión.
// El backend le pregunta a Mercado Pago y, si el pago está aprobado, confirma la reserva.

import type { DatosRetorno } from './qrPago';

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

export type EstadoRetorno =
  'confirmada' | 'en_proceso' | 'rechazado' | 'cancelada' | 'revision';

export interface ReservaRetorno {
  id: string;
  codigo: string;
  fecha_ingreso: string;
  fecha_egreso: string;
  cantidad_personas: number;
}

export interface EstadoPagoRetorno {
  estado: EstadoRetorno;
  mensaje: string;
  reserva: ReservaRetorno;
}

/**
 * datos: la reserva y el pago de la URL no coinciden (no tiene sentido reintentar).
 * temporal: no se pudo consultar ahora (Mercado Pago o la conexión); se puede reintentar.
 */
export class ErrorEstadoPago extends Error {
  motivo: 'datos' | 'temporal';

  constructor(message: string, motivo: 'datos' | 'temporal') {
    super(message);
    this.motivo = motivo;
  }
}

export const MENSAJE_DATOS_NO_COINCIDEN =
  'No encontramos un pago de Mercado Pago para esta reserva.';
const MENSAJE_SIN_CONEXION =
  'No pudimos consultar el estado del pago. Lo volvemos a intentar.';

export async function consultarEstadoPago({
  reservaId,
  paymentId,
}: DatosRetorno): Promise<EstadoPagoRetorno> {
  const url =
    `${API_URL}/api/payments/estado/${encodeURIComponent(reservaId)}` +
    `?payment_id=${encodeURIComponent(paymentId)}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(url);
  } catch {
    throw new ErrorEstadoPago(MENSAJE_SIN_CONEXION, 'temporal');
  }

  // 422: el id de la reserva no tiene el formato correcto
  if (respuesta.status === 404 || respuesta.status === 422) {
    throw new ErrorEstadoPago(MENSAJE_DATOS_NO_COINCIDEN, 'datos');
  }
  if (!respuesta.ok) {
    throw new ErrorEstadoPago(MENSAJE_SIN_CONEXION, 'temporal');
  }
  return (await respuesta.json()) as EstadoPagoRetorno;
}
