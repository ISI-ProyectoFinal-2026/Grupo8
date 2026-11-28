import { decodeJwt } from 'jose';

/**
 * Fecha de vencimiento (claim `exp`, en segundos desde 1970) del token, o null si no se puede leer.
 *
 * Solo decodifica el payload: no verifica la firma, y no hace falta. El `exp` es un dato público del token
 * (un JWT está codificado, no cifrado) y acá solo sirve para decidir qué le mostramos al guardia.
 * La autoridad es el servidor, que revalida firma y vencimiento en cada request, incluido /bulk-sync.
 */
export function leerExpiracion(
  token: string | null | undefined
): number | null {
  if (!token) return null;
  try {
    const { exp } = decodeJwt(token);
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    // Token malformado: no se puede saber cuándo vence
    return null;
  }
}

/**
 * El token ya pasó su `exp`. Un token sin `exp`, ilegible o vacío NO cuenta como vencido:
 * para el que no se puede leer decide la validación del rol, no esta función.
 */
export function tokenVencido(
  token: string | null | undefined,
  ahoraMs: number = Date.now()
): boolean {
  const exp = leerExpiracion(token);
  return exp !== null && exp * 1000 <= ahoraMs;
}

/** Milisegundos que faltan para que venza el token, o null si no tiene `exp` o ya venció. */
export function msHastaVencimiento(
  token: string | null | undefined,
  ahoraMs: number = Date.now()
): number | null {
  const exp = leerExpiracion(token);
  if (exp === null) return null;
  const falta = exp * 1000 - ahoraMs;
  return falta > 0 ? falta : null;
}
