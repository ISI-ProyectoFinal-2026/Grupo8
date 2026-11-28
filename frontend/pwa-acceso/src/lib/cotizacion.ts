import { validarEdad } from '@/lib/validaciones';

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

export type CondicionPersona = 'visitante' | 'socio';

export interface PersonaCotizar {
  edad: number;
  condicion: CondicionPersona;
}

export interface CotizarDetalle {
  indice: number;
  condicion_efectiva: CondicionPersona;
  descuento_codigo: string | null;
  descuento_pct: number;
  precio_base: number;
  precio_final: number;
}

// Lo que responde POST /reservas/cotizar. Todos los importes los calcula el backend.
export interface Cotizacion {
  moneda: string;
  subtotal: number;
  descuento_total: number;
  total: number;
  cantidad_socios: number;
  detalle: CotizarDetalle[];
  // Solo cuando se cotiza con un tipo. Por unidad, detalle va vacío y llegan las noches
  forma_cobro?: 'POR_PERSONA' | 'POR_UNIDAD' | null;
  precio_unitario?: number | null;
  noches?: number | null;
  // Por unidad: porcentaje de descuento de socio aplicado (null si el titular no es socio)
  descuento_pct?: number | null;
  // Por persona: las noches que se cobraron a cada una (con 0 noches, visita por el día, vale 1)
  jornadas?: number | null;
}

// Mensaje cuando la cotización falla sin un motivo del backend (por ejemplo, sin conexión)
export const ERROR_COTIZACION_GENERICO = 'No se pudo calcular el precio.';

interface PersonaDelFormulario {
  edad: string;
  condicion: string;
}

// Arma lo que pide la cotización a partir del formulario. Devuelve null mientras falte
// la edad de alguna persona, porque sin ella todavía no se puede calcular el precio.
export function personasParaCotizar(personas: PersonaDelFormulario[]): PersonaCotizar[] | null {
  if (personas.length === 0) return null;
  const resultado: PersonaCotizar[] = [];
  for (const persona of personas) {
    if (validarEdad(persona.edad) !== null) return null;
    resultado.push({
      edad: Number(persona.edad),
      condicion: persona.condicion === 'socio' ? 'socio' : 'visitante',
    });
  }
  return resultado;
}

// Cómo se nombra lo que se cobra por persona: noches, o una jornada si se viene por el día
export function etiquetaJornadas(jornadas: number, porElDia: boolean): string {
  if (porElDia) return '1 jornada';
  return `${jornadas} ${jornadas === 1 ? 'noche' : 'noches'}`;
}

export function formatearMonto(valor: number): string {
  return `$${valor.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// El backend explica por qué no se puede cotizar (máximo de personas, tipo desactivado...).
// Ese motivo se muestra tal cual; si no hay motivo se usa el mensaje genérico.
async function pedirCotizacion(cuerpo: object, signal?: AbortSignal): Promise<Cotizacion> {
  const respuesta = await fetch(`${API_URL}/reservas/cotizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal,
  });
  if (!respuesta.ok) {
    let motivo = ERROR_COTIZACION_GENERICO;
    try {
      const error = await respuesta.json();
      if (typeof error.detail === 'string') motivo = error.detail;
    } catch {
      // la respuesta no traía JSON
    }
    throw new Error(motivo);
  }
  return (await respuesta.json()) as Cotizacion;
}

export interface FechasCotizacion {
  fecha_ingreso: string;
  fecha_egreso: string;
}

/**
 * Por persona: cada una con su edad y condición, por las noches de la estadía.
 * Sin tipo se cotiza con el precio base. Sin fechas el backend cobra una sola jornada.
 */
export function cotizarReserva(
  personas: PersonaCotizar[],
  signal?: AbortSignal,
  tipoReservaId?: string,
  fechas?: FechasCotizacion
): Promise<Cotizacion> {
  const cuerpo = {
    ...(tipoReservaId ? { tipo_reserva_id: tipoReservaId } : {}),
    personas,
    ...(fechas ?? {}),
  };
  return pedirCotizacion(cuerpo, signal);
}

export interface PedidoPorUnidad {
  tipo_reserva_id: string;
  cantidad_personas: number;
  fecha_ingreso: string;
  fecha_egreso: string;
  // DNI del titular, solo si ya se verificó como socio vigente: el backend lo valida de nuevo y descuenta
  dni_titular?: string;
}

/** Por unidad (cabaña): precio de la unidad × noches, sin datos de cada persona. */
export function cotizarPorUnidad(pedido: PedidoPorUnidad, signal?: AbortSignal): Promise<Cotizacion> {
  return pedirCotizacion(pedido, signal);
}