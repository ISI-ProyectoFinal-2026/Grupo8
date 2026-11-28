import type { IJwtPayload } from '../types/security';
import { verificarQR } from '../utils/security';
import { evaluarVigenciaQR } from '../utils/vigenciaQR';
import { dbService } from './dbService';

/**
 * Resultado discriminado del flujo de validación de acceso por QR.
 * Permite distinguir explícitamente:
 * - INVALID_TOKEN: firma inválida o sin fechas de vigencia legibles (falla criptográfica o de formato).
 * - FUERA_DE_FECHA: firma válida, pero el QR no incluye el día de hoy (de Buenos Aires) o ya venció.
 * - REVOKED: firma válida y vigente, pero el identificador está en la blacklist local.
 * - VALID: firma válida, vigente y no revocado -> se puede registrar el ingreso.
 */

export type QRAccessValidationResult =
  | { status: 'INVALID_TOKEN' }
  | { status: 'FUERA_DE_FECHA' }
  | { status: 'REVOKED'; payload: IJwtPayload }
  | { status: 'VALID'; payload: IJwtPayload };

export async function validarAccesoQR(token: string): Promise<QRAccessValidationResult> {
  // 1. Firma: lo que sigue se apoya en fechas que solo son confiables si el token es auténtico
  const verificacion = await verificarQR(token);
  if (!verificacion.ok) {
    // Un QR auténtico pero vencido es de una estadía que ya terminó: no es un QR falso
    return verificacion.motivo === 'VENCIDO' ? { status: 'FUERA_DE_FECHA' } : { status: 'INVALID_TOKEN' };
  }
  const { payload } = verificacion;

  // 2. Vigencia (sin red ni base de datos): el día de hoy tiene que estar dentro de la estadía
  const vigencia = evaluarVigenciaQR(payload);
  if (!vigencia.vigente) {
    return vigencia.motivo === 'FECHAS_INVALIDAS' ? { status: 'INVALID_TOKEN' } : { status: 'FUERA_DE_FECHA' };
  }

  // 3. Revocación (blacklist descargada en IndexedDB)
  const identificador = payload.reserva_id.toString();
  const estaRevocado = await dbService.verificarAccesoRevocado(identificador);

  if (estaRevocado) {
    return { status: 'REVOKED', payload };
  }

  return { status: 'VALID', payload };
}
