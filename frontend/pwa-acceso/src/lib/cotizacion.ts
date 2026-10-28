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
}

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

export async function cotizarReserva(
  personas: PersonaCotizar[],
  signal?: AbortSignal
): Promise<Cotizacion> {
  const respuesta = await fetch(`${API_URL}/reservas/cotizar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personas }),
    signal,
  });
  if (!respuesta.ok) {
    throw new Error('No se pudo calcular el precio.');
  }
  return (await respuesta.json()) as Cotizacion;
}
