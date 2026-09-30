import type { IJwtPayload } from '../types/security';
import { verifyQRToken } from '../utils/security';
import { dbService } from './dbService';

/**
 * Resultado discriminado del flujo de validación de acceso por QR.
 * Permite distinguir explícitamente:
 * - INVALID_TOKEN: firma inválida o token expirado (falla criptográfica).
 * - REVOKED: firma válida, pero el identificador está en la blacklist local.
 * - VALID: firma válida y no revocado -> se puede registrar el ingreso.
 */

export type QRAccessValidationResult =
  | { status: 'INVALID_TOKEN' }
  | { status: 'REVOKED'; payload: IJwtPayload }
  | { status: 'VALID'; payload: IJwtPayload };

export async function validarAccesoQR(token: string): Promise<QRAccessValidationResult> {
  const payload = await verifyQRToken(token);

  if (!payload) {
    return { status: 'INVALID_TOKEN' };
  }

  const identificador = payload.reserva_id.toString();
  const estaRevocado = await dbService.verificarAccesoRevocado(identificador);

  if (estaRevocado) {
    return { status: 'REVOKED', payload };
  }

  return { status: 'VALID', payload };
}