import { AUTH_EXPIRED_EVENT, type Rol } from '@/context/AuthContext';

// URL base del backend (se puede sobreescribir con VITE_API_URL en el .env del frontend)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

/** Pantalla a la que va cada rol después de iniciar sesión. */
export const RUTA_POR_ROL: Record<Rol, string> = {
  SEGURIDAD: '/acceso',
  ADMIN: '/admin',
  CLIENTE: '/perfil',
};

/** Error con un mensaje listo para mostrarle a la persona que intenta ingresar. */
export class ErrorLogin extends Error {}

/** Llama a POST /auth/login y devuelve el token de acceso. */
export async function solicitarLogin(identificador: string, password: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificador: identificador.trim(), password }),
    });
  } catch {
    throw new ErrorLogin('No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
  }

  if (response.status === 401) throw new ErrorLogin('DNI, correo o contraseña incorrectos.');
  if (response.status === 422) throw new ErrorLogin('Revisá los datos ingresados.');
  if (!response.ok) {
    throw new ErrorLogin('Ocurrió un error en el servidor. Intentá de nuevo en unos minutos.');
  }

  try {
    const datos = (await response.json()) as { access_token?: unknown };
    if (typeof datos.access_token === 'string') return datos.access_token;
  } catch {
    // Se informa abajo, igual que cuando falta el token
  }
  throw new ErrorLogin('El servidor respondió algo inesperado. Intentá de nuevo.');
}

/** Datos del usuario con sesión, tal como los devuelve GET /auth/me. */
export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  dni: string;
  rol: Rol;
  is_socio: boolean;
  membresia_vigente: boolean;
  /** Fecha AAAA-MM-DD, o null si no hay una registrada. */
  membresia_vence: string | null;
}

export class ErrorPerfil extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Pide los datos del usuario con sesión (GET /auth/me). Si el token ya no sirve (401) avisa
 * a la app para que cierre la sesión.
 */
export async function obtenerUsuarioActual(token: string, signal?: AbortSignal): Promise<UsuarioSesion> {
  const respuesta = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (respuesta.status === 401) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new ErrorPerfil('Tu sesión venció. Iniciá sesión de nuevo.', 401);
  }
  if (!respuesta.ok) {
    throw new ErrorPerfil('No pudimos cargar tus datos. Intentá nuevamente.', respuesta.status);
  }
  return (await respuesta.json()) as UsuarioSesion;
}