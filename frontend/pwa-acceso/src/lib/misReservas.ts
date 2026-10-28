import { AUTH_EXPIRED_EVENT } from '@/context/AuthContext';

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

// Los estados llegan con el mismo texto que guarda el backend
export type EstadoReserva = 'Pendiente' | 'Confirmada' | 'Cancelada' | 'Finalizada';

export interface PersonaReserva {
  nombre: string;
  edad: number;
  condicion: 'visitante' | 'socio';
  dni: string | null;
  precio_base: number;
  descuento_pct: number;
  precio_final: number;
}

/** Una reserva tal como la devuelve GET /reservas/mias. */
export interface ReservaDetalle {
  id: string;
  fecha_reserva: string;
  fecha_ingreso: string;
  fecha_egreso: string;
  cantidad_personas: number;
  cantidad_socios: number;
  monto_total: number;
  titular: string;
  estado_reserva: EstadoReserva;
  estado_pago: string;
  personas: PersonaReserva[];
}

/** Pestaña de la pantalla en la que se muestra cada reserva. */
export type CategoriaReserva = 'pendiente' | 'proxima' | 'finalizada' | 'cancelada';

export const CATEGORIAS: CategoriaReserva[] = ['pendiente', 'proxima', 'finalizada', 'cancelada'];

/**
 * Decide en qué pestaña va una reserva. `hoyISO` es la fecha de hoy (AAAA-MM-DD).
 * Una reserva confirmada cuyo egreso ya pasó se muestra como finalizada, aunque el backend
 * todavía no la haya marcado así.
 */
export function clasificarReserva(
  reserva: Pick<ReservaDetalle, 'estado_reserva' | 'fecha_egreso'>,
  hoyISO: string
): CategoriaReserva {
  switch (reserva.estado_reserva) {
    case 'Cancelada':
      return 'cancelada';
    case 'Finalizada':
      return 'finalizada';
    case 'Pendiente':
      return 'pendiente';
    default:
      return reserva.fecha_egreso < hoyISO ? 'finalizada' : 'proxima';
  }
}

/** Fecha de hoy en AAAA-MM-DD, con el calendario local del navegador. */
export function hoyISO(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function agruparReservas(
  reservas: ReservaDetalle[],
  hoy: string = hoyISO()
): Record<CategoriaReserva, ReservaDetalle[]> {
  const grupos: Record<CategoriaReserva, ReservaDetalle[]> = {
    pendiente: [],
    proxima: [],
    finalizada: [],
    cancelada: [],
  };
  for (const reserva of reservas) {
    grupos[clasificarReserva(reserva, hoy)].push(reserva);
  }
  return grupos;
}

export class ErrorMisReservas extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Pide las reservas del usuario con sesión. El backend decide de quién son según el token,
 * por eso no se manda ningún id de usuario. Si el token ya no sirve (401) avisa a la app
 * para que cierre la sesión.
 */
export async function obtenerMisReservas(token: string, signal?: AbortSignal): Promise<ReservaDetalle[]> {
  const respuesta = await fetch(`${API_URL}/reservas/mias`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (respuesta.status === 401) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new ErrorMisReservas('Tu sesión venció. Iniciá sesión de nuevo.', 401);
  }
  if (!respuesta.ok) {
    throw new ErrorMisReservas('No pudimos cargar tus reservas. Intentá nuevamente.', respuesta.status);
  }
  return (await respuesta.json()) as ReservaDetalle[];
}
