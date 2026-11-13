import { createHmac, randomUUID } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { SECRETO_WEBHOOK_MP, URL_BACKEND } from '../entorno';

/**
 * Firma un aviso igual que Mercado Pago: HMAC-SHA256 del manifiesto
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con la clave secreta del webhook.
 * El backend lo valida con el mismo validador del SDK (aviso_autentico).
 */
function firmarAviso(dataId: string, requestId: string, ts: number): string {
  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', SECRETO_WEBHOOK_MP)
    .update(manifiesto)
    .digest('hex');
  return `ts=${ts},v1=${v1}`;
}

/** Manda al backend el aviso de pago que en producción enviaría Mercado Pago. */
export async function enviarAvisoDePago(
  request: APIRequestContext,
  paymentId: string
): Promise<APIResponse> {
  const requestId = randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  return request.post(`${URL_BACKEND}/api/payments/webhook`, {
    params: { 'data.id': paymentId, type: 'payment' },
    headers: {
      'x-signature': firmarAviso(paymentId, requestId, ts),
      'x-request-id': requestId,
    },
    data: {
      action: 'payment.updated',
      type: 'payment',
      data: { id: paymentId },
    },
  });
}
