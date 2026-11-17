// Descarga del QR desde la pantalla a la que vuelve Mercado Pago (/pago/exito), sin sesión.
// El backend la permite con el id del pago aprobado de la reserva.

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

export const MENSAJE_QR_GENERANDO =
  'Tu QR todavía se está generando. Intentá de nuevo en unos segundos o revisá tu correo.';
export const MENSAJE_DATOS_FALTANTES =
  'No pudimos identificar tu reserva con los datos que envió Mercado Pago. Igual te enviamos el QR por correo electrónico.';
export const MENSAJE_QR_NO_ENCONTRADO =
  'No encontramos el QR de esta reserva. Igual te lo enviamos por correo electrónico.';
export const MENSAJE_ERROR_DESCARGA =
  'No pudimos descargar el QR. Intentá nuevamente; también te lo enviamos por correo electrónico.';

/**
 * generando: el pago todavía no se confirmó, se puede reintentar.
 * no_encontrado: la reserva y el pago no coinciden o el QR no está disponible.
 * error: falló el servidor o la conexión.
 */
export type MotivoErrorQr = 'generando' | 'no_encontrado' | 'error';

export class ErrorQrPago extends Error {
  motivo: MotivoErrorQr;

  constructor(message: string, motivo: MotivoErrorQr) {
    super(message);
    this.motivo = motivo;
  }
}

export interface DatosRetorno {
  reservaId: string;
  paymentId: string;
}

/** La reserva (external_reference) y el pago (payment_id) con los que vuelve Mercado Pago. Null si falta alguno. */
export function datosDelRetorno(params: URLSearchParams): DatosRetorno | null {
  const reservaId = params.get('external_reference')?.trim();
  const paymentId = params.get('payment_id')?.trim();
  // Mercado Pago a veces manda el texto "null" cuando no hay pago
  if (!reservaId || !paymentId || paymentId === 'null') return null;
  return { reservaId, paymentId };
}

/** Pide el QR de la reserva recién pagada. Es el mismo QR que llega por correo. */
export async function descargarQrDelPago({
  reservaId,
  paymentId,
}: DatosRetorno): Promise<Blob> {
  const url =
    `${API_URL}/reservas/${encodeURIComponent(reservaId)}/qr-pago` +
    `?payment_id=${encodeURIComponent(paymentId)}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(url);
  } catch {
    throw new ErrorQrPago(MENSAJE_ERROR_DESCARGA, 'error');
  }

  if (respuesta.status === 409) {
    throw new ErrorQrPago(MENSAJE_QR_GENERANDO, 'generando');
  }
  // 422: el id de la reserva no tiene el formato correcto
  if ([403, 404, 422].includes(respuesta.status)) {
    throw new ErrorQrPago(MENSAJE_QR_NO_ENCONTRADO, 'no_encontrado');
  }
  if (!respuesta.ok) {
    throw new ErrorQrPago(MENSAJE_ERROR_DESCARGA, 'error');
  }
  return respuesta.blob();
}
