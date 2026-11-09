// Padrón de socios desde el panel de administración (/admin/socios): alta, listado con búsqueda
// y filtros, edición, renovación, baja y reactivación.
// Las reglas de validación son las mismas que aplica el backend (y las de validaciones.ts).
import { ErrorApi } from '@/lib/descuentos';
import { hoyISO, validarDni, validarEmail, validarFecha, validarNombre } from '@/lib/validaciones';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const PASSWORD_MIN = 8;
// bcrypt no admite contraseñas de más de 72 bytes
export const PASSWORD_MAX_BYTES = 72;

export interface Socio {
  id: string;
  nombre: string;
  dni: string;
  email: string;
  /** Fecha AAAA-MM-DD, o null si no tiene una cargada. */
  membresia_vence: string | null;
  membresia_vigente: boolean;
  /** false si fue dado de baja: no puede iniciar sesión ni valida como socio. */
  activo: boolean;
}

// ---------- Estado de la membresía ----------

/** Los mismos valores que acepta el filtro `estado` del backend. */
export type EstadoSocio = 'vigente' | 'vencida' | 'baja';

export const ETIQUETA_ESTADO: Record<EstadoSocio, string> = {
  vigente: 'Vigente',
  vencida: 'Vencida',
  baja: 'De baja',
};

/** La baja manda sobre la fecha: un dado de baja figura de baja aunque su cuota esté al día. */
export function estadoDeSocio(socio: Socio): EstadoSocio {
  if (!socio.activo) return 'baja';
  return socio.membresia_vigente ? 'vigente' : 'vencida';
}

// ---------- Búsqueda y filtros ----------

export interface FiltrosSocios {
  /** DNI (o su comienzo) o palabras del nombre. */
  buscar: string;
  /** Vacío = todos los estados. */
  estado: EstadoSocio | '';
}

export const filtrosVacios: FiltrosSocios = { buscar: '', estado: '' };

export const BUSCAR_MAX = 100;

export function hayFiltros(filtros: FiltrosSocios): boolean {
  return filtros.buscar.trim() !== '' || filtros.estado !== '';
}

/** Arma "?buscar=...&estado=..." solo con los filtros que tienen valor. */
export function construirConsulta(filtros: FiltrosSocios): string {
  const parametros = new URLSearchParams();
  const buscar = filtros.buscar.trim();
  if (buscar) parametros.set('buscar', buscar);
  if (filtros.estado) parametros.set('estado', filtros.estado);
  const consulta = parametros.toString();
  return consulta ? `?${consulta}` : '';
}

/** Valores del formulario tal como se escriben. */
export interface SocioFormulario {
  nombre: string;
  dni: string;
  email: string;
  password: string;
  membresia_vence: string;
}

export type CampoSocio = keyof SocioFormulario;
export type ErroresSocio = Partial<Record<CampoSocio, string>>;

export const formularioVacio: SocioFormulario = {
  nombre: '',
  dni: '',
  email: '',
  password: '',
  membresia_vence: '',
};

/** La contraseña no se recorta: se guarda exactamente como se escribe. */
export function validarPassword(valor: string): string | null {
  if (!valor) return 'La contraseña inicial es obligatoria.';
  if (valor.length < PASSWORD_MIN)
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (new TextEncoder().encode(valor).length > PASSWORD_MAX_BYTES)
    return 'La contraseña es demasiado larga.';
  return null;
}

export function validarVencimiento(valor: string): string | null {
  return validarFecha(valor, 'La fecha de vencimiento');
}

export function validarSocio(form: SocioFormulario): ErroresSocio {
  const errores: ErroresSocio = {};
  const campos: [CampoSocio, string | null][] = [
    ['nombre', validarNombre(form.nombre)],
    ['dni', validarDni(form.dni)],
    ['email', validarEmail(form.email)],
    ['password', validarPassword(form.password)],
    ['membresia_vence', validarVencimiento(form.membresia_vence)],
  ];
  for (const [campo, error] of campos) {
    if (error) errores[campo] = error;
  }
  return errores;
}

export function construirPayload(form: SocioFormulario) {
  return {
    nombre: form.nombre.trim(),
    dni: form.dni.trim(),
    email: form.email.trim(),
    password: form.password,
    membresia_vence: form.membresia_vence,
  };
}

// ---------- Edición ----------

/** Datos que se pueden corregir. La fecha se cambia con la renovación. */
export interface EdicionFormulario {
  nombre: string;
  dni: string;
  email: string;
}

export type ErroresEdicion = Partial<Record<keyof EdicionFormulario, string>>;

export function formularioEdicion(socio: Socio): EdicionFormulario {
  return { nombre: socio.nombre, dni: socio.dni, email: socio.email };
}

export function validarEdicion(form: EdicionFormulario): ErroresEdicion {
  const errores: ErroresEdicion = {};
  const campos: [keyof EdicionFormulario, string | null][] = [
    ['nombre', validarNombre(form.nombre)],
    ['dni', validarDni(form.dni)],
    ['email', validarEmail(form.email)],
  ];
  for (const [campo, error] of campos) {
    if (error) errores[campo] = error;
  }
  return errores;
}

/** Solo los campos que cambiaron: el backend aplica únicamente lo que recibe. */
export function cambiosEdicion(socio: Socio, form: EdicionFormulario): Partial<EdicionFormulario> {
  const cambios: Partial<EdicionFormulario> = {};
  const nombre = form.nombre.trim();
  const dni = form.dni.trim();
  const email = form.email.trim();
  if (nombre !== socio.nombre) cambios.nombre = nombre;
  if (dni !== socio.dni) cambios.dni = dni;
  if (email.toLowerCase() !== socio.email.toLowerCase()) cambios.email = email;
  return cambios;
}

// ---------- Renovación ----------

/** Suma años a una fecha AAAA-MM-DD sin pasar por la zona horaria (el 29/2 pasa al 1/3). */
export function sumarAnios(fechaIso: string, anios: number): string {
  const [anio, mes, dia] = fechaIso.split('-').map(Number);
  return new Date(Date.UTC(anio + anios, mes - 1, dia)).toISOString().slice(0, 10);
}

/**
 * Fecha que se propone al renovar: un año más desde el vencimiento actual,
 * o desde hoy si ya venció o no tiene fecha.
 */
export function fechaRenovacionSugerida(socio: Socio, hoy: string = hoyISO()): string {
  const desde = socio.membresia_vence && socio.membresia_vence > hoy ? socio.membresia_vence : hoy;
  return sumarAnios(desde, 1);
}

/** Hoy se acepta: la membresía vale hasta el final de ese día. */
export function validarRenovacion(valor: string, hoy: string = hoyISO()): string | null {
  const error = validarFecha(valor, 'La nueva fecha de vencimiento');
  if (error) return error;
  if (valor < hoy) return 'La nueva fecha de vencimiento no puede ser anterior a hoy.';
  return null;
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

async function pedir<T>(
  token: string,
  ruta: string,
  metodo: 'GET' | 'POST' | 'PUT',
  cuerpo?: object
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/admin/socios${ruta}`, {
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

export const listarSocios = (token: string, filtros: FiltrosSocios = filtrosVacios) =>
  pedir<Socio[]>(token, construirConsulta(filtros), 'GET');

export const crearSocio = (token: string, form: SocioFormulario) =>
  pedir<Socio>(token, '', 'POST', construirPayload(form));

export const editarSocio = (token: string, id: string, cambios: Partial<EdicionFormulario>) =>
  pedir<Socio>(token, `/${id}`, 'PUT', cambios);

export const renovarMembresia = (token: string, id: string, membresiaVence: string) =>
  pedir<Socio>(token, `/${id}/renovar`, 'POST', { membresia_vence: membresiaVence });

export const darDeBaja = (token: string, id: string) =>
  pedir<Socio>(token, `/${id}/baja`, 'POST');

export const reactivarSocio = (token: string, id: string) =>
  pedir<Socio>(token, `/${id}/reactivar`, 'POST');
