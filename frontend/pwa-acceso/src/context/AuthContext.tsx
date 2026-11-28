import { decodeJwt } from 'jose';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { dbService } from '@/services/dbService';
import { msHastaVencimiento, tokenVencido as tokenVencidoEn } from '@/utils/sesionToken';

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
  /** Motivo por el que se cerró la sesión sola (por ejemplo, el aviso de syncService). Se borra al iniciar sesión. */
  avisoSesion: string | null;
  /** Se está leyendo la sesión guardada en el dispositivo (IndexedDB). Mientras dura no se sabe si hay sesión. */
  cargando: boolean;
  /** El token del guardia ya venció y no hay conexión: puede seguir escaneando, pero no sincronizar. */
  sesionVencidaOffline: boolean;
}

/** Aviso al volver a abrir la app con la sesión vencida y conexión (el guardia puede iniciar sesión de nuevo). */
export const MENSAJE_SESION_VENCIDA = 'Tu sesión venció. Iniciá sesión de nuevo.';

/** setTimeout no admite más que esto (≈24,8 días): un valor mayor se dispara al instante. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Lo que puede acompañar a AUTH_EXPIRED_EVENT. Sin detalle, la sesión se cierra sin aviso. */
export interface DetalleSesionVencida {
  mensaje?: string;
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

/** El token ya pasó su `exp`. Al guardia se le conserva la sesión sin red, pero el servidor lo va a rechazar. */
export function tokenVencido(token: string | null): boolean {
  return tokenVencidoEn(token);
}

/** Rol que trae el token, o null si no es un token utilizable. No abre ninguna sesión. */
export function rolDeToken(token: string): Rol | null {
  return sesionDesdeToken(token)?.rol ?? null;
}

/** Rol que trae un token legible, aunque haya vencido. */
function rolDeTokenAunqueVencido(token: string): Rol | null {
  try {
    const { rol } = decodeJwt(token);
    const normalizado = typeof rol === 'string' ? rol.toUpperCase() : '';
    return ROLES.includes(normalizado) ? (normalizado as Rol) : null;
  } catch {
    return null;
  }
}

function leerTokenLocal(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Sesión de la web de reservas y del panel (CLIENTE y ADMIN): siguen en localStorage y se leen sin esperar.
 * Estas apps necesitan conexión para todo, así que un token vencido se descarta.
 * La del guardia (SEGURIDAD) vive en IndexedDB (28.2): acá se deja pasar y la recupera `recuperarSesionGuardia`.
 */
function leerSesionLocal(): Sesion | null {
  const token = leerTokenLocal();
  if (!token) return null;
  if (rolDeTokenAunqueVencido(token) === 'SEGURIDAD') return null;
  const sesion = sesionDesdeToken(token);
  // Token vencido o ilegible: se descarta para no reintentarlo en cada carga.
  if (!sesion) borrarToken();
  return sesion;
}

type ResultadoRecuperacion =
  | { sesion: Sesion; aviso: null }
  | { sesion: null; aviso: string | null };

/**
 * Arranque en frío del guardia: lee la sesión de IndexedDB y decide qué hacer con ella.
 *  - Token vigente: se conserva, haya o no conexión.
 *  - Vencido y sin conexión: se conserva. Puede seguir escaneando; el aviso lo da `sesionVencidaOffline`.
 *  - Vencido y con conexión: se descarta y se pide iniciar sesión (con conexión sí puede hacerlo).
 *  - Ilegible o de otro rol: se descarta sin aviso.
 * Si no hay nada en IndexedDB pero sí un token del guardia en localStorage (sesión abierta con la versión
 * anterior de la app), se lo pasa a IndexedDB para que la actualización no lo saque de la sesión.
 */
async function recuperarSesionGuardia(enLinea: boolean): Promise<ResultadoRecuperacion> {
  let token: string | null = null;
  try {
    token = (await dbService.obtenerSesion())?.token ?? null;
  } catch {
    // IndexedDB no disponible (por ejemplo, navegación privada): no hay nada que recuperar
  }

  if (!token) {
    const heredado = leerTokenLocal();
    if (!heredado || rolDeTokenAunqueVencido(heredado) !== 'SEGURIDAD') return { sesion: null, aviso: null };
    token = heredado;
  }

  const sesion = sesionDesdeToken(token, !enLinea);
  if (sesion?.rol === 'SEGURIDAD') {
    // Deja la copia en IndexedDB y retira la de localStorage (si venía de ahí)
    try {
      await dbService.guardarSesion(sesion.token, sesion.rol);
    } catch {
      // Sin IndexedDB la sesión vive solo en memoria
    }
    borrarToken();
    return { sesion, aviso: null };
  }

  await descartarSesionGuardada();
  const vencidoConRed = enLinea && rolDeTokenAunqueVencido(token) === 'SEGURIDAD' && tokenVencidoEn(token);
  return { sesion: null, aviso: vencidoConRed ? MENSAJE_SESION_VENCIDA : null };
}

/** Borra la sesión del guardia de IndexedDB (y la copia vieja de localStorage). No toca la cola de ingresos. */
async function descartarSesionGuardada(): Promise<void> {
  borrarToken();
  try {
    await dbService.eliminarSesion();
  } catch {
    // Nada que borrar si IndexedDB no está disponible
  }
}

/** Token de la sesión del guardia guardada en el dispositivo, para los pedidos al servidor. */
export async function leerTokenGuardia(): Promise<string | null> {
  try {
    return (await dbService.obtenerSesion())?.token ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesionLocal);
  const [avisoSesion, setAvisoSesion] = useState<string | null>(null);
  // Con una sesión de la web o del panel ya no hay nada que esperar; sin ella hay que mirar IndexedDB
  const [cargando, setCargando] = useState(() => sesion === null);
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);
  // Cambia cuando el token del guardia llega a su `exp`, para recalcular sesionVencidaOffline sin recargar
  const [reloj, setReloj] = useState(0);
  // Si la persona inició o cerró sesión mientras se leía IndexedDB, lo leído ya no vale
  const huboCambio = useRef(false);

  const cerrarSesion = useCallback(() => {
    huboCambio.current = true;
    setSesion(null);
    setAvisoSesion(null);
    void descartarSesionGuardada();
  }, []);

  const iniciarSesion = useCallback((token: string) => {
    huboCambio.current = true;
    const nueva = sesionDesdeToken(token);
    if (!nueva) {
      borrarToken();
      setSesion(null);
      return false;
    }
    if (nueva.rol === 'SEGURIDAD') {
      // El guardia: IndexedDB. Se retira cualquier copia vieja de localStorage
      borrarToken();
      dbService.guardarSesion(nueva.token, nueva.rol).catch(() => {
        // Sin IndexedDB la sesión vive solo en memoria
      });
    } else {
      guardarToken(token);
      // Si en este dispositivo había una sesión de guardia, ya no corresponde
      dbService.eliminarSesion().catch(() => {});
    }
    setSesion(nueva);
    setAvisoSesion(null);
    setCargando(false);
    return true;
  }, []);

  // Arranque: recuperar la sesión del guardia desde IndexedDB, con o sin conexión
  useEffect(() => {
    if (sesion !== null) return;
    let cancelado = false;
    void recuperarSesionGuardia(navigator.onLine).then((resultado) => {
      if (cancelado || huboCambio.current) return;
      setSesion(resultado.sesion);
      setAvisoSesion(resultado.aviso);
      setCargando(false);
    });
    return () => {
      cancelado = true;
    };
    // Solo al montar: después, la sesión cambia por iniciarSesion/cerrarSesion
  }, []);

  useEffect(() => {
    // Si el evento trae un mensaje, el login lo muestra para que se entienda por qué se cerró
    const alVencer = (evento: Event) => {
      const { mensaje } = (evento as CustomEvent<DetalleSesionVencida | null>).detail ?? {};
      huboCambio.current = true;
      void descartarSesionGuardada();
      setSesion(null);
      setAvisoSesion(typeof mensaje === 'string' ? mensaje : null);
      setCargando(false);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, alVencer);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, alVencer);
  }, []);

  useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine);
    window.addEventListener('online', actualizar);
    window.addEventListener('offline', actualizar);
    return () => {
      window.removeEventListener('online', actualizar);
      window.removeEventListener('offline', actualizar);
    };
  }, []);

  // Si el token vence con la app abierta, se recalcula el aviso en ese momento
  const token = sesion?.token ?? null;
  useEffect(() => {
    const falta = msHastaVencimiento(token);
    if (falta === null) return;
    const temporizador = setTimeout(() => setReloj(Date.now()), Math.min(falta + 250, MAX_TIMEOUT_MS));
    return () => clearTimeout(temporizador);
  }, [token]);

  const sesionVencidaOffline = useMemo(
    () => sesion?.rol === 'SEGURIDAD' && !enLinea && tokenVencidoEn(sesion.token),
    // `reloj` fuerza el recálculo cuando se cumple el `exp`
    [sesion, enLinea, reloj]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token: sesion?.token ?? null,
      rol: sesion?.rol ?? null,
      estaAutenticado: sesion !== null,
      iniciarSesion,
      cerrarSesion,
      avisoSesion,
      cargando,
      sesionVencidaOffline,
    }),
    [sesion, iniciarSesion, cerrarSesion, avisoSesion, cargando, sesionVencidaOffline]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}