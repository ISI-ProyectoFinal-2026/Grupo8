// Configuración del camping desde el panel (/admin/configuracion): cupo, buffer offline
// y máximo de personas por reserva. Las reglas son las mismas que valida el backend.
import { ErrorApi } from '@/lib/descuentos';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Tope de seguridad, igual que CAPACIDAD_MAXIMA_PERMITIDA del backend
export const CAPACIDAD_MAXIMA = 1_000_000;

const ENTERO_REGEX = /^\d+$/;

export interface ConfiguracionCamping {
  capacidad_total: number;
  porcentaje_buffer_offline: number;
  max_personas_por_reserva: number;
  /** Sugerencia para el buffer; no se guarda. */
  porcentaje_buffer_recomendado: number;
}

/** Valores del formulario tal como se escriben: los números viajan como texto hasta validarlos. */
export interface ConfiguracionFormulario {
  capacidad_total: string;
  porcentaje_buffer_offline: string;
  max_personas_por_reserva: string;
}

export type CampoConfiguracion = keyof ConfiguracionFormulario;
export type ErroresConfiguracion = Partial<Record<CampoConfiguracion, string>>;

export function formularioDesdeConfiguracion(
  config: ConfiguracionCamping
): ConfiguracionFormulario {
  return {
    capacidad_total: String(config.capacidad_total),
    porcentaje_buffer_offline: String(config.porcentaje_buffer_offline),
    max_personas_por_reserva: String(config.max_personas_por_reserva),
  };
}

// ---------- Cálculos ----------

/** Lugares que se guardan para la puerta, redondeado hacia arriba (10 % de 45 = 5). */
export function bufferEnPersonas(
  capacidad: number,
  porcentaje: number
): number {
  // Cuenta entera para no arrastrar errores de decimales
  return Math.floor((capacidad * porcentaje + 99) / 100);
}

/** Lugares que se pueden vender por la web: la capacidad sin el buffer. */
export function cupoOnline(capacidad: number, porcentaje: number): number {
  return capacidad - bufferEnPersonas(capacidad, porcentaje);
}

/** Número entero sin signo, o null si el texto no lo es. */
export function parsearEntero(valor: string): number | null {
  const v = valor.trim();
  return ENTERO_REGEX.test(v) ? Number(v) : null;
}

// ---------- Validación ----------

export function validarCapacidad(valor: string): string | null {
  if (!valor.trim()) return 'Ingresá el cupo del camping.';
  const n = parsearEntero(valor);
  if (n === null) return 'El cupo tiene que ser un número entero.';
  if (n < 1) return 'El cupo tiene que ser mayor a 0.';
  if (n > CAPACIDAD_MAXIMA)
    return `El cupo no puede superar ${CAPACIDAD_MAXIMA.toLocaleString('es-AR')} personas.`;
  return null;
}

export function validarBuffer(valor: string): string | null {
  if (!valor.trim()) return 'Ingresá el porcentaje de buffer.';
  const n = parsearEntero(valor);
  if (n === null)
    return 'El buffer tiene que ser un porcentaje entero, sin decimales.';
  if (n > 100) return 'El buffer tiene que estar entre 0 % y 100 %.';
  return null;
}

export function validarConfiguracion(
  form: ConfiguracionFormulario
): ErroresConfiguracion {
  const errores: ErroresConfiguracion = {};

  const errorCapacidad = validarCapacidad(form.capacidad_total);
  if (errorCapacidad) errores.capacidad_total = errorCapacidad;

  const errorBuffer = validarBuffer(form.porcentaje_buffer_offline);
  if (errorBuffer) errores.porcentaje_buffer_offline = errorBuffer;

  const maximo = parsearEntero(form.max_personas_por_reserva);
  if (!form.max_personas_por_reserva.trim()) {
    errores.max_personas_por_reserva =
      'Ingresá el máximo de personas por reserva.';
  } else if (maximo === null) {
    errores.max_personas_por_reserva =
      'El máximo tiene que ser un número entero.';
  } else if (maximo < 1) {
    errores.max_personas_por_reserva = 'El máximo tiene que ser mayor a 0.';
  } else if (!errorCapacidad && !errorBuffer) {
    // Solo se puede comparar con el cupo online si los otros dos valores son válidos
    const cupo = cupoOnline(
      Number(form.capacidad_total.trim()),
      Number(form.porcentaje_buffer_offline.trim())
    );
    if (maximo > cupo) {
      errores.max_personas_por_reserva = `El máximo no puede superar el cupo online (${cupo} personas).`;
    }
  }

  return errores;
}

export function construirPayload(form: ConfiguracionFormulario) {
  return {
    capacidad_total: Number(form.capacidad_total.trim()),
    porcentaje_buffer_offline: Number(form.porcentaje_buffer_offline.trim()),
    max_personas_por_reserva: Number(form.max_personas_por_reserva.trim()),
  };
}

// ---------- Llamadas a la API ----------

async function extraerMensaje(response: Response): Promise<string> {
  try {
    const cuerpo = await response.json();
    if (Array.isArray(cuerpo.detail)) {
      return cuerpo.detail
        .map((d: { msg: string }) => d.msg.replace(/^Value error, /, ''))
        .join('\n');
    }
    if (typeof cuerpo.detail === 'string') return cuerpo.detail;
  } catch {
    // La respuesta no era JSON: se usa el mensaje genérico.
  }
  return 'No se pudo completar la operación. Intentá de nuevo.';
}

async function pedir(
  token: string,
  metodo: 'GET' | 'PUT',
  cuerpo?: object
): Promise<ConfiguracionCamping> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/admin/configuracion`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor.', 0);
  }
  if (!response.ok)
    throw new ErrorApi(await extraerMensaje(response), response.status);
  return (await response.json()) as ConfiguracionCamping;
}

export const obtenerConfiguracion = (token: string) => pedir(token, 'GET');

export const guardarConfiguracion = (
  token: string,
  form: ConfiguracionFormulario
) => pedir(token, 'PUT', construirPayload(form));
