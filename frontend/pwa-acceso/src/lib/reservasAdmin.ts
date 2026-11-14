// Gestión de reservas desde el panel de administración (/admin/reservas): listado con filtros
// y paginación (GET /reservas/) y detalle de cada reserva (GET /reservas/{id}).
import { ErrorApi } from '@/lib/descuentos';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const TAMANIO_PAGINA = 20;
export const BUSQUEDA_MAX = 100;

// Los estados viajan con el mismo texto que guarda el backend
export type EstadoReserva = 'Pendiente' | 'Confirmada' | 'Cancelada' | 'Finalizada' | 'Alerta de clonación';
export type EstadoPago = 'Pendiente' | 'Pagado' | 'Cancelado';
export type TipoCliente = 'socio' | 'visitante';

export const ESTADOS_RESERVA: EstadoReserva[] = [
  'Pendiente',
  'Confirmada',
  'Cancelada',
  'Finalizada',
  'Alerta de clonación',
];

export const ETIQUETA_TIPO_CLIENTE: Record<TipoCliente, string> = {
  socio: 'Socio',
  visitante: 'Visitante',
};

export interface PersonaReserva {
  nombre: string;
  edad: number;
  condicion: TipoCliente;
  dni: string | null;
  precio_base: number;
  descuento_pct: number;
  precio_final: number;
}

/** Una fila de la tabla. */
export interface ReservaAdmin {
  id: string;
  titular: string;
  email: string;
  telefono: string | null;
  tipo_cliente: TipoCliente;
  fecha_reserva: string;
  fecha_ingreso: string; // AAAA-MM-DD
  fecha_egreso: string; // AAAA-MM-DD
  cantidad_personas: number;
  monto_total: number;
  estado_reserva: EstadoReserva;
  estado_pago: EstadoPago;
  // Vacío en las reservas por unidad, que solo guardan el titular
  personas: PersonaReserva[];
}

export interface ReservasPaginadas {
  total: number;
  items: ReservaAdmin[];
}

export interface PagoReserva {
  id: string;
  mp_payment_id: string;
  estado: string; // como lo informa Mercado Pago: approved, rejected, refunded...
  monto: number | null;
  metodo_pago: string | null;
  fecha_creacion: string;
  fecha_aprobacion: string | null;
  monto_devuelto: number | null;
  devolucion_estado: string | null;
}

export interface DetalleReserva extends ReservaAdmin {
  tipo_reserva_nombre: string | null;
  pagos: PagoReserva[];
  ya_ingreso: boolean;
  fecha_primer_ingreso: string | null;
}

/** Filtros tal como se cargan en la pantalla. Las cadenas vacías son "sin filtro". */
export interface FiltrosReservas {
  busqueda: string;
  estadoReserva: EstadoReserva | '';
  tipoCliente: TipoCliente | '';
  fechaDesde: string;
  fechaHasta: string;
}

export const filtrosVacios: FiltrosReservas = {
  busqueda: '',
  estadoReserva: '',
  tipoCliente: '',
  fechaDesde: '',
  fechaHasta: '',
};

export function hayFiltros(filtros: FiltrosReservas): boolean {
  return Object.values(filtros).some((valor) => valor.trim() !== '');
}

/** Las fechas AAAA-MM-DD se pueden comparar como texto. */
export function rangoInvalido(filtros: FiltrosReservas): boolean {
  return !!filtros.fechaDesde && !!filtros.fechaHasta && filtros.fechaHasta < filtros.fechaDesde;
}

/** Arma la consulta de GET /reservas/ con los nombres que espera el backend. */
export function construirConsulta(filtros: FiltrosReservas, pagina: number): string {
  const parametros = new URLSearchParams({
    skip: String(pagina * TAMANIO_PAGINA),
    limit: String(TAMANIO_PAGINA),
  });
  const busqueda = filtros.busqueda.trim();
  if (busqueda) parametros.set('busqueda', busqueda);
  if (filtros.estadoReserva) parametros.set('estado_reserva', filtros.estadoReserva);
  if (filtros.tipoCliente) parametros.set('tipo_cliente', filtros.tipoCliente);
  if (filtros.fechaDesde) parametros.set('fecha_desde', filtros.fechaDesde);
  if (filtros.fechaHasta) parametros.set('fecha_hasta', filtros.fechaHasta);
  return `?${parametros.toString()}`;
}

/** Número de reserva que se muestra en el panel: el comienzo del id, como en Mis reservas. */
export function numeroReserva(id: string): string {
  return `#${id.slice(0, 8)}`;
}

/** "Mostrando 21–40 de 120". */
export function textoPaginacion(pagina: number, cantidadEnPagina: number, total: number): string {
  if (total === 0 || cantidadEnPagina === 0) return 'Sin resultados';
  const desde = pagina * TAMANIO_PAGINA + 1;
  const hasta = desde + cantidadEnPagina - 1;
  return `Mostrando ${desde}–${hasta} de ${total}`;
}

export function totalPaginas(total: number): number {
  return Math.max(1, Math.ceil(total / TAMANIO_PAGINA));
}

const ETIQUETA_ESTADO_PAGO_MP: Record<string, string> = {
  approved: 'Aprobado',
  authorized: 'Autorizado',
  pending: 'Pendiente',
  in_process: 'En proceso',
  in_mediation: 'En mediación',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  refunded: 'Devuelto',
  charged_back: 'Contracargo',
};

/** Estado de un pago de Mercado Pago en castellano; si no se conoce, el original. */
export function etiquetaEstadoPago(estado: string): string {
  return ETIQUETA_ESTADO_PAGO_MP[estado] ?? estado;
}

/**
 * Fecha y hora de Buenos Aires para un instante que viene del backend.
 * Algunas fechas (como fecha_reserva) se guardan en UTC sin zona: se les agrega la Z.
 */
export function formatearFechaHora(iso: string): string {
  const conZona = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  return new Date(conZona).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

async function extraerMensaje(response: Response): Promise<string> {
  try {
    const cuerpo = await response.json();
    if (typeof cuerpo.detail === 'string') return cuerpo.detail;
  } catch {
    // La respuesta no era JSON: se usa el mensaje genérico.
  }
  if (response.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
  if (response.status === 403) return 'No tenés permisos para ver las reservas.';
  return 'No se pudo cargar la información. Intentá de nuevo.';
}

async function pedir<T>(token: string, ruta: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/reservas/${ruta}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    // Un pedido cancelado a propósito no es un error de conexión
    if (signal?.aborted) throw error;
    throw new ErrorApi('No se pudo conectar con el servidor.', 0);
  }
  if (!response.ok) throw new ErrorApi(await extraerMensaje(response), response.status);
  return (await response.json()) as T;
}

export const listarReservas = (
  token: string,
  filtros: FiltrosReservas,
  pagina: number,
  signal?: AbortSignal
) => pedir<ReservasPaginadas>(token, construirConsulta(filtros, pagina), signal);

export const obtenerDetalleReserva = (token: string, id: string, signal?: AbortSignal) =>
  pedir<DetalleReserva>(token, encodeURIComponent(id), signal);
