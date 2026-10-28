import type { Rol } from '@/context/AuthContext';

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