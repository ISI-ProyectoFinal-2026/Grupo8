// Alta y listado de socios desde el panel de administración (GET/POST /admin/socios).
// Las reglas de validación son las mismas que aplica el backend (y las de validaciones.ts).
import { ErrorApi } from '@/lib/descuentos';
import { validarDni, validarEmail, validarFecha, validarNombre } from '@/lib/validaciones';

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

async function pedir<T>(token: string, metodo: 'GET' | 'POST', cuerpo?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/admin/socios`, {
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

export const listarSocios = (token: string) => pedir<Socio[]>(token, 'GET');

export const crearSocio = (token: string, form: SocioFormulario) =>
  pedir<Socio>(token, 'POST', construirPayload(form));
