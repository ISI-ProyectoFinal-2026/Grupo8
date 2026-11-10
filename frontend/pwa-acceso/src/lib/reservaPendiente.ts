// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

/** La reserva recién creada que todavía hay que pagar. */
export interface ReservaPendiente {
  id: string;
  /** Hasta cuándo se puede pagar (ISO, con zona horaria), tal como lo devuelve POST /reservas. */
  vencimiento: string;
  /** Lo que se ve en el checkout de Mercado Pago. */
  titulo: string;
}

// sessionStorage: sobrevive a la ida y vuelta a Mercado Pago, pero no queda guardada
// si se cierra la pestaña
const CLAVE = 'qamp.reservaPendiente';

export function guardarReservaPendiente(reserva: ReservaPendiente): void {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(reserva));
  } catch {
    // Sin almacenamiento disponible la pantalla de pago igual funciona con el estado de la navegación
  }
}

export function leerReservaPendiente(): ReservaPendiente | null {
  try {
    const guardada = sessionStorage.getItem(CLAVE);
    return guardada ? (JSON.parse(guardada) as ReservaPendiente) : null;
  } catch {
    return null;
  }
}

export function borrarReservaPendiente(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // nada que borrar
  }
}

/** Milisegundos que faltan para el vencimiento (0 si ya venció). */
export function msRestantes(vencimiento: string, ahora: number = Date.now()): number {
  return Math.max(0, new Date(vencimiento).getTime() - ahora);
}

/** "mm:ss" a partir de milisegundos. */
export function formatearRestante(ms: number): string {
  const totalSegundos = Math.ceil(ms / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

export type ResultadoPago =
  | { tipo: 'ok'; initPoint: string }
  | { tipo: 'vencida' }
  | { tipo: 'error'; mensaje: string };

/** Crea la preferencia de Mercado Pago de la reserva y devuelve el link de pago. */
export async function crearPago(reserva: ReservaPendiente): Promise<ResultadoPago> {
  const response = await fetch(`${API_URL}/api/payments/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: reserva.titulo, reserva_id: reserva.id }),
  });

  let datos: { init_point?: string; detail?: string } = {};
  try {
    datos = await response.json();
  } catch {
    // respuesta sin JSON
  }

  if (response.ok && datos.init_point) return { tipo: 'ok', initPoint: datos.init_point };
  // 409 con el plazo vencido: el backend ya no abre un checkout para esa reserva
  if (response.status === 409 && typeof datos.detail === 'string' && datos.detail.includes('venció')) {
    return { tipo: 'vencida' };
  }
  return {
    tipo: 'error',
    mensaje: typeof datos.detail === 'string' ? datos.detail : 'Error al conectar con Mercado Pago. Intentá nuevamente.',
  };
}
