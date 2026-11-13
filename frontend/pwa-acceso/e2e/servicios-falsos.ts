import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/**
 * Imitación mínima de Mercado Pago y Resend para las pruebas E2E.
 *
 * El backend no sabe que son falsos: el SDK de Mercado Pago apunta acá con MERCADOPAGO_API_URL
 * y el de Resend con RESEND_API_URL. Solo se implementan las rutas que usa Qamp.
 *
 * Mercado Pago:
 *   POST /checkout/preferences           crear preferencia (POST /api/payments/create)
 *   GET  /checkout/:id                   pantalla de pago simulada (a donde va el cliente)
 *   POST /checkout/:id/pagar             aprueba el pago y vuelve a back_urls.success
 *   GET  /v1/payments/search             búsqueda por external_reference
 *   GET  /v1/payments/:id                consulta de un pago (la usa el webhook)
 *   POST /v1/payments/:id/refunds        reembolso
 * Resend:
 *   POST /emails                         guarda el correo en memoria
 * Para los tests:
 *   GET  /__e2e/salud                    el servidor está listo
 *   GET  /__e2e/correos?para=<email>     correos enviados a esa dirección
 */

interface Preferencia {
  id: string;
  externalReference: string;
  monto: number;
  backUrls: { success: string; failure: string; pending: string };
}

export interface PagoFalso {
  id: number;
  status: 'approved' | 'rejected' | 'refunded';
  status_detail: string;
  external_reference: string;
  transaction_amount: number;
  currency_id: 'ARS';
  payment_method_id: string;
  payment_type_id: string;
  date_created: string;
  date_approved: string | null;
  live_mode: false;
}

export interface CorreoFalso {
  id: string;
  to: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: number[]; content_id?: string }[];
}

const preferencias = new Map<string, Preferencia>();
const pagos = new Map<number, PagoFalso>();
const correos: CorreoFalso[] = [];
let siguienteId = 1_000_001;

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString('utf-8');
}

function responderJson(
  res: ServerResponse,
  estado: number,
  cuerpo: unknown
): void {
  res.writeHead(estado, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

function pantallaDePago(pref: Preferencia): string {
  // HTML simple pero accesible: el test la recorre con getByRole como cualquier otra pantalla
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Mercado Pago (simulado)</title></head>
<body><main>
  <h1>Mercado Pago (simulado)</h1>
  <p>Total a pagar: $ ${pref.monto.toFixed(2)}</p>
  <form method="post" action="/checkout/${pref.id}/pagar"><button type="submit">Pagar</button></form>
</main></body></html>`;
}

async function atender(
  req: IncomingMessage,
  res: ServerResponse,
  urlPropia: string
): Promise<void> {
  const url = new URL(req.url ?? '/', urlPropia);
  const metodo = req.method ?? 'GET';
  const ruta = url.pathname;
  let coincidencia: RegExpMatchArray | null;

  if (metodo === 'GET' && ruta === '/__e2e/salud') {
    return responderJson(res, 200, { status: 'ok' });
  }

  if (metodo === 'GET' && ruta === '/__e2e/correos') {
    const para = url.searchParams.get('para');
    return responderJson(
      res,
      200,
      correos.filter((c) => !para || c.to.includes(para))
    );
  }

  // --- Resend ---
  if (metodo === 'POST' && ruta === '/emails') {
    const correo = {
      id: `correo-${correos.length + 1}`,
      ...JSON.parse(await leerCuerpo(req)),
    } as CorreoFalso;
    correos.push(correo);
    return responderJson(res, 200, { id: correo.id });
  }

  // --- Mercado Pago ---
  if (metodo === 'POST' && ruta === '/checkout/preferences') {
    const datos = JSON.parse(await leerCuerpo(req));
    const pref: Preferencia = {
      id: `pref-${siguienteId++}`,
      externalReference: datos.external_reference,
      monto: Number(datos.items[0].unit_price),
      backUrls: datos.back_urls,
    };
    preferencias.set(pref.id, pref);
    const puntoDePago = `${urlPropia}/checkout/${pref.id}`;
    return responderJson(res, 201, {
      id: pref.id,
      init_point: puntoDePago,
      sandbox_init_point: puntoDePago,
    });
  }

  if (
    (coincidencia = ruta.match(/^\/checkout\/([^/]+)$/)) &&
    metodo === 'GET'
  ) {
    const pref = preferencias.get(coincidencia[1]);
    if (!pref)
      return responderJson(res, 404, { message: 'preference not found' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pantallaDePago(pref));
    return;
  }

  if (
    (coincidencia = ruta.match(/^\/checkout\/([^/]+)\/pagar$/)) &&
    metodo === 'POST'
  ) {
    const pref = preferencias.get(coincidencia[1]);
    if (!pref)
      return responderJson(res, 404, { message: 'preference not found' });
    const ahora = new Date().toISOString();
    const pago: PagoFalso = {
      id: siguienteId++,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: pref.externalReference,
      transaction_amount: pref.monto,
      currency_id: 'ARS',
      payment_method_id: 'visa',
      payment_type_id: 'credit_card',
      date_created: ahora,
      date_approved: ahora,
      live_mode: false,
    };
    pagos.set(pago.id, pago);
    // Igual que Mercado Pago: vuelve al sitio con los datos del pago en la URL.
    // El aviso (webhook) NO sale de acá: lo manda el test, firmado, para controlar cuándo llega
    const vuelta = new URL(pref.backUrls.success);
    vuelta.searchParams.set('payment_id', String(pago.id));
    vuelta.searchParams.set('collection_status', 'approved');
    vuelta.searchParams.set('external_reference', pref.externalReference);
    vuelta.searchParams.set('preference_id', pref.id);
    res.writeHead(303, { Location: vuelta.toString() });
    res.end();
    return;
  }

  if (metodo === 'GET' && ruta === '/v1/payments/search') {
    const referencia = url.searchParams.get('external_reference');
    const resultados = [...pagos.values()].filter(
      (p) => p.external_reference === referencia
    );
    return responderJson(res, 200, {
      results: resultados,
      paging: { total: resultados.length },
    });
  }

  if (
    (coincidencia = ruta.match(/^\/v1\/payments\/(\d+)$/)) &&
    metodo === 'GET'
  ) {
    const pago = pagos.get(Number(coincidencia[1]));
    return pago
      ? responderJson(res, 200, pago)
      : responderJson(res, 404, { message: 'Payment not found' });
  }

  if (
    (coincidencia = ruta.match(/^\/v1\/payments\/(\d+)\/refunds$/)) &&
    metodo === 'POST'
  ) {
    const pago = pagos.get(Number(coincidencia[1]));
    if (!pago) return responderJson(res, 404, { message: 'Payment not found' });
    pago.status = 'refunded';
    return responderJson(res, 201, {
      id: siguienteId++,
      payment_id: pago.id,
      status: 'approved',
    });
  }

  responderJson(res, 404, { message: `Ruta no simulada: ${metodo} ${ruta}` });
}

export function iniciarServiciosFalsos(puerto: number): Promise<Server> {
  const urlPropia = `http://localhost:${puerto}`;
  const servidor = createServer((req, res) => {
    atender(req, res, urlPropia).catch((error: unknown) => {
      console.error('[servicios falsos]', error);
      responderJson(res, 500, { message: String(error) });
    });
  });
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(puerto, () => resolve(servidor));
  });
}
