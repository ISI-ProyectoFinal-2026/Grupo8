import { validarEmail, validarNombre } from '@/lib/validaciones';

/**
 * Formulario de Contacto (31.5): se usa sin sesión. El mensaje sale por POST /contacto del backend,
 * que lo envía con Resend al correo del camping: ni la clave de Resend ni el destinatario pasan por acá.
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

// Tienen que coincidir con los del backend (schemas/contacto.py)
export const MENSAJE_MIN = 10;
export const MENSAJE_MAX = 2000;

const SIN_CONEXION = 'No se pudo conectar con el servidor. Intentá nuevamente.';
const ERROR_GENERICO = 'No pudimos enviar tu mensaje. Intentá nuevamente en unos minutos.';

export interface DatosContacto {
  nombre: string;
  email: string;
  mensaje: string;
}

export type ErroresContacto = Partial<Record<keyof DatosContacto, string>>;

export class ErrorContacto extends Error {
  /** 0 sin conexión; 422 datos inválidos; 429 demasiados envíos; 502/503 el correo no salió. */
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function validarMensaje(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El mensaje es obligatorio.';
  if (v.length < MENSAJE_MIN) return `El mensaje debe tener al menos ${MENSAJE_MIN} caracteres.`;
  if (v.length > MENSAJE_MAX) return `El mensaje no puede superar los ${MENSAJE_MAX} caracteres.`;
  return null;
}

/** Errores de cada campo; vacío si los datos están bien. El backend vuelve a validar todo. */
export function validarContacto(datos: DatosContacto): ErroresContacto {
  const errores: ErroresContacto = {};
  const nombre = validarNombre(datos.nombre);
  const email = validarEmail(datos.email);
  const mensaje = validarMensaje(datos.mensaje);
  if (nombre) errores.nombre = nombre;
  if (email) errores.email = email;
  if (mensaje) errores.mensaje = mensaje;
  return errores;
}

/** Envía el mensaje. Devuelve el aviso del backend; lanza ErrorContacto si no salió. */
export async function enviarContacto(datos: DatosContacto): Promise<string> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${API_URL}/contacto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: datos.nombre.trim(),
        email: datos.email.trim(),
        mensaje: datos.mensaje.trim(),
      }),
    });
  } catch {
    throw new ErrorContacto(SIN_CONEXION, 0);
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    // La respuesta no era JSON: quedan los mensajes por defecto
  }

  if (!respuesta.ok) {
    const detalle = (cuerpo as { detail?: unknown } | null)?.detail;
    // En 429, 502 y 503 el backend explica qué pasó; un 422 trae una lista técnica que no se muestra
    const explicado =
      [429, 502, 503].includes(respuesta.status) && typeof detalle === 'string'
        ? detalle
        : null;
    const porDefecto =
      respuesta.status === 422 ? 'Revisá los datos ingresados e intentá nuevamente.' : ERROR_GENERICO;
    throw new ErrorContacto(explicado ?? porDefecto, respuesta.status);
  }

  const mensaje = (cuerpo as { mensaje?: unknown } | null)?.mensaje;
  return typeof mensaje === 'string' && mensaje
    ? mensaje
    : '¡Mensaje enviado! Te vamos a responder por correo lo antes posible.';
}
