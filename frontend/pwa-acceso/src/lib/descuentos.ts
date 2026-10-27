// Descuentos configurables desde el panel de administración (GET/POST/PUT /admin/descuentos).
// Las reglas de validación son las mismas que aplica el backend.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const EDAD_MAXIMA = 120;

const CODIGO_REGEX = /^[a-z][a-z0-9_]{1,29}$/;
const PORCENTAJE_REGEX = /^\d{1,3}(\.\d{1,2})?$/;

export type AplicaDescuento = 'socio' | 'edad';

export interface Descuento {
  id: string;
  codigo: string;
  nombre: string;
  aplica_a: AplicaDescuento;
  porcentaje: number;
  edad_min: number | null;
  edad_max: number | null;
  activo: boolean;
}

/** Valores del formulario tal como se escriben: los números viajan como texto hasta validarlos. */
export interface DescuentoFormulario {
  codigo: string;
  nombre: string;
  aplica_a: AplicaDescuento;
  porcentaje: string;
  edad_min: string;
  edad_max: string;
  activo: boolean;
}

export type CampoDescuento = 'codigo' | 'nombre' | 'porcentaje' | 'edad_min' | 'edad_max';
export type ErroresDescuento = Partial<Record<CampoDescuento, string>>;

export const formularioVacio: DescuentoFormulario = {
  codigo: '',
  nombre: '',
  aplica_a: 'edad',
  porcentaje: '',
  edad_min: '',
  edad_max: '',
  activo: true,
};

export function formularioDesdeDescuento(descuento: Descuento): DescuentoFormulario {
  return {
    codigo: descuento.codigo,
    nombre: descuento.nombre,
    aplica_a: descuento.aplica_a,
    porcentaje: String(descuento.porcentaje),
    edad_min: descuento.edad_min === null ? '' : String(descuento.edad_min),
    edad_max: descuento.edad_max === null ? '' : String(descuento.edad_max),
    activo: descuento.activo,
  };
}

export function validarCodigo(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El código es obligatorio.';
  if (!CODIGO_REGEX.test(v))
    return 'El código debe tener entre 2 y 30 caracteres: minúsculas, números y guion bajo, empezando con una letra.';
  return null;
}

export function validarNombreDescuento(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El nombre es obligatorio.';
  if (v.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (v.length > 100) return 'El nombre no puede superar los 100 caracteres.';
  return null;
}

/** Acepta coma o punto como separador decimal. */
export function parsearPorcentaje(valor: string): number | null {
  const v = valor.trim().replace(',', '.');
  if (!PORCENTAJE_REGEX.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= 100 ? n : null;
}

export function validarPorcentaje(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El porcentaje es obligatorio.';
  if (parsearPorcentaje(v) === null)
    return 'Ingresá un porcentaje entre 0 y 100, con hasta 2 decimales.';
  return null;
}

export function validarLimiteEdad(valor: string, etiqueta: string): string | null {
  const v = valor.trim();
  if (!v) return `${etiqueta} es obligatoria.`;
  if (!/^\d+$/.test(v) || Number(v) > EDAD_MAXIMA)
    return `${etiqueta} debe ser un número entre 0 y ${EDAD_MAXIMA}.`;
  return null;
}

/** En modo edición el código no se modifica, así que no se valida. */
export function validarDescuento(
  form: DescuentoFormulario,
  modo: 'crear' | 'editar'
): ErroresDescuento {
  const errores: ErroresDescuento = {};

  if (modo === 'crear') {
    const eCodigo = validarCodigo(form.codigo);
    if (eCodigo) errores.codigo = eCodigo;
  }
  const eNombre = validarNombreDescuento(form.nombre);
  if (eNombre) errores.nombre = eNombre;
  const ePorcentaje = validarPorcentaje(form.porcentaje);
  if (ePorcentaje) errores.porcentaje = ePorcentaje;

  if (form.aplica_a === 'edad') {
    const eMin = validarLimiteEdad(form.edad_min, 'La edad mínima');
    const eMax = validarLimiteEdad(form.edad_max, 'La edad máxima');
    if (eMin) errores.edad_min = eMin;
    if (eMax) errores.edad_max = eMax;
    if (!eMin && !eMax && Number(form.edad_min) > Number(form.edad_max))
      errores.edad_min = 'La edad mínima no puede ser mayor que la máxima.';
  }
  return errores;
}

export function construirPayload(form: DescuentoFormulario, modo: 'crear' | 'editar') {
  const porcentaje = parsearPorcentaje(form.porcentaje) ?? 0;
  const limites =
    form.aplica_a === 'edad'
      ? { edad_min: Number(form.edad_min), edad_max: Number(form.edad_max) }
      : {};
  const comunes = { nombre: form.nombre.trim(), porcentaje, activo: form.activo, ...limites };
  return modo === 'crear'
    ? { codigo: form.codigo.trim(), aplica_a: form.aplica_a, ...comunes }
    : comunes;
}

export function formatearPorcentaje(valor: number): string {
  return `${valor.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

export function describirAplicacion(descuento: Descuento): string {
  if (descuento.aplica_a === 'socio') return 'Socios';
  return `De ${descuento.edad_min} a ${descuento.edad_max} años`;
}

// ---------- Llamadas a la API ----------

export class ErrorApi extends Error {
  status: number;

  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.status = status;
  }
}

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

async function pedir<T>(
  token: string,
  ruta: string,
  metodo: 'GET' | 'POST' | 'PUT',
  cuerpo?: object
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/admin/descuentos${ruta}`, {
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
  if (!response.ok) throw new ErrorApi(await extraerMensaje(response), response.status);
  return (await response.json()) as T;
}

export const listarDescuentos = (token: string) => pedir<Descuento[]>(token, '', 'GET');

export const crearDescuento = (token: string, form: DescuentoFormulario) =>
  pedir<Descuento>(token, '', 'POST', construirPayload(form, 'crear'));

export const modificarDescuento = (token: string, id: string, cambios: object) =>
  pedir<Descuento>(token, `/${id}`, 'PUT', cambios);

export const modificarDescuentoDesdeFormulario = (
  token: string,
  id: string,
  form: DescuentoFormulario
) => modificarDescuento(token, id, construirPayload(form, 'editar'));
