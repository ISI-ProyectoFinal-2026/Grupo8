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

/** Por persona: cada una con su edad y condición. Sin tipo se cotiza con el precio base. */
export function cotizarReserva(
  personas: PersonaCotizar[],
  signal?: AbortSignal,
  tipoReservaId?: string
): Promise<Cotizacion> {
  const cuerpo = tipoReservaId ? { tipo_reserva_id: tipoReservaId, personas } : { personas };
  return pedirCotizacion(cuerpo, signal);
}

export interface PedidoPorUnidad {
  tipo_reserva_id: string;
  cantidad_personas: number;
  fecha_ingreso: string;
  fecha_egreso: string;
}

/** Por unidad (cabaña): precio de la unidad × noches, sin datos de cada persona. */
export function cotizarPorUnidad(pedido: PedidoPorUnidad, signal?: AbortSignal): Promise<Cotizacion> {
  return pedirCotizacion(pedido, signal);
}
