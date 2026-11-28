import { jwtVerify, importSPKI, errors } from 'jose';
import type { IJwtPayload } from '../types/security';

export type ResultadoVerificacionQR =
  | { ok: true; payload: IJwtPayload }
  // VENCIDO: la firma es auténtica pero ya pasó el `exp` (el QR es de una estadía que terminó)
  | { ok: false; motivo: 'FIRMA_INVALIDA' | 'VENCIDO' };

/**
 * Verifica matemáticamente la autenticidad de un código QR offline.
 * Utiliza la Clave Pública inyectada en tiempo de compilación.
 * A diferencia de verifyQRToken, distingue un QR vencido de uno falso: jose primero comprueba
 * la firma y recién después los claims, así que VENCIDO solo sale con un token auténtico.
 */
export async function verificarQR(token: string): Promise<ResultadoVerificacionQR> {
  try {
    // 1. Acceso a la variable de entorno inyectada por Vite (Fail-Fast)
    const publicKeyPem = import.meta.env.VITE_PUBLIC_KEY;
    if (!publicKeyPem) {
      throw new Error('Configuración crítica: VITE_PUBLIC_KEY ausente.');
    }

    // 2. Formateo de saltos de línea (por si el .env los inyecta como literales)
    const cleanPublicKey = publicKeyPem.replace(/\\n/g, '\n');

    // 3. Conversión de formato PEM a objeto CryptoKey nativo del navegador
    const publicKey = await importSPKI(cleanPublicKey, 'ES256');

    // 4. Verificación criptográfica
    // jwtVerify automáticamente arroja error si la firma es inválida o si el token expiró (campo 'exp')
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['ES256'],
    });

    // 5. Retorno del payload fuertemente tipado
    return { ok: true, payload: payload as unknown as IJwtPayload };
  } catch (error) {
    // Encapsulamos el error para no romper la UI del escáner.
    console.error('QR Rechazado (Firma inválida o token expirado):', error);
    return { ok: false, motivo: error instanceof errors.JWTExpired ? 'VENCIDO' : 'FIRMA_INVALIDA' };
  }
}

/**
 * Verifica un QR y devuelve su payload, o null si fue manipulado o expiró.
 * Para saber cuál de los dos casos fue, usar verificarQR.
 */
export async function verifyQRToken(
  token: string
): Promise<IJwtPayload | null> {
  const resultado = await verificarQR(token);
  return resultado.ok ? resultado.payload : null;
}
