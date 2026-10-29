import { decodeJwt } from 'jose';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export const TOKEN_KEY = 'qamp_token';
export const AUTH_EXPIRED_EVENT = 'qamp:auth-expired';

export type Rol = 'ADMIN' | 'SEGURIDAD' | 'CLIENTE';
const ROLES: readonly string[] = ['ADMIN', 'SEGURIDAD', 'CLIENTE'];

interface Sesion {
  token: string;
  rol: Rol;
}

interface AuthContextValue {
  token: string | null;
  rol: Rol | null;
  estaAutenticado: boolean;
  /** Guarda el token y abre la sesión. Devuelve false si el token no es utilizable. */
  iniciarSesion: (token: string) => boolean;
  cerrarSesion: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function guardarToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Almacenamiento bloqueado: la sesión vive solo en memoria.
  }
}

function borrarToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nada que limpiar si el almacenamiento no está disponible.
  }
}

// El claim `rol` sirve solo para la interfaz: el backend revalida el rol en cada request.
// Con `tolerarVencido`, un token vencido del guardia sigue valiendo para la interfaz (ver leerSesionGuardada).
function sesionDesdeToken(token: string | null, tolerarVencido = false): Sesion | null {
  if (!token) return null;
  try {
    const { rol, exp } = decodeJwt(token);
    const rolNormalizado = typeof rol === 'string' ? rol.toUpperCase() : '';
    if (!ROLES.includes(rolNormalizado)) return null;
    const vencido = typeof exp === 'number' && exp * 1000 <= Date.now();
    if (vencido && !(tolerarVencido && rolNormalizado === 'SEGURIDAD')) return null;
    return { token, rol: rolNormalizado as Rol };
  } catch {
    return null;
  }
}

function leerSesionGuardada(): Sesion | null {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
  // El guardia puede trabajar días sin red y con la red caída no puede volver a iniciar sesión:
  // si su token venció y no hay conexión, se conserva la sesión para que pueda seguir escaneando.
  // Al recuperar la red, bulk-sync responde 401 y ahí se le pide iniciar sesión de nuevo.
  const sesion = sesionDesdeToken(token, !navigator.onLine);
  // Token vencido o ilegible: se descarta para no reintentarlo en cada carga.
  if (!sesion && token) borrarToken();
  return sesion;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesionGuardada);

  const cerrarSesion = useCallback(() => {
    borrarToken();
    setSesion(null);
  }, []);

  const iniciarSesion = useCallback((token: string) => {
    const nueva = sesionDesdeToken(token);
    if (!nueva) {
      borrarToken();
      setSesion(null);
      return false;
    }
    guardarToken(token);
    setSesion(nueva);
    return true;
  }, []);

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, cerrarSesion);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, cerrarSesion);
  }, [cerrarSesion]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token: sesion?.token ?? null,
      rol: sesion?.rol ?? null,
      estaAutenticado: sesion !== null,
      iniciarSesion,
      cerrarSesion,
    }),
    [sesion, iniciarSesion, cerrarSesion]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}