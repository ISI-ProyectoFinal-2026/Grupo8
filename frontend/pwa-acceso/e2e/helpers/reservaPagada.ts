import { expect, type APIRequestContext } from '@playwright/test';
import { URL_BACKEND } from '../entorno';
import { enviarAvisoDePago } from './mercadoPago';
import { esperarQrDelCorreo, leerQr } from './qr';
import { hoyEnArgentina } from './sesion';

interface TipoReserva {
  id: string;
  nombre: string;
}

/**
 * Prepara por API una reserva pagada y devuelve el texto de su QR.
 *
 * Es el mismo camino que la 24.1 recorre por pantalla (reserva → preferencia → pago en el
 * Mercado Pago falso → aviso firmado → correo con el QR), pero sin navegador: lo que se prueba
 * en la 24.2 es la app del guardia, y armar los datos por API es más rápido y más estable.
 */
export async function crearReservaPagada(
  request: APIRequestContext,
  nombres: string[]
): Promise<{ email: string; tokenQr: string }> {
  const email = `offline-${Date.now()}@example.com`;
  const hoy = hoyEnArgentina();

  const tipos = (await (
    await request.get(`${URL_BACKEND}/api/v1/tipos-reserva`)
  ).json()) as TipoReserva[];
  const entradaGeneral = tipos.find((t) => /entrada general/i.test(t.nombre));
  expect(
    entradaGeneral,
    'Falta el tipo "Entrada general" de las migraciones'
  ).toBeTruthy();

  const reserva = await request.post(`${URL_BACKEND}/reservas/`, {
    data: {
      fecha_ingreso: hoy,
      fecha_egreso: hoy,
      tipo_reserva_id: entradaGeneral!.id,
      email,
      personas: nombres.map((nombre) => ({
        nombre,
        edad: 30,
        condicion: 'visitante',
      })),
    },
  });
  expect(reserva.status(), await reserva.text()).toBe(201);
  const { id: reservaId } = (await reserva.json()) as { id: string };

  const preferencia = await request.post(`${URL_BACKEND}/api/payments/create`, {
    data: { title: 'Reserva E2E', reserva_id: reservaId },
  });
  expect(preferencia.ok(), await preferencia.text()).toBeTruthy();
  const { init_point } = (await preferencia.json()) as { init_point: string };

  // El "clic en Pagar" del checkout falso: responde 303 con el payment_id en la URL de vuelta
  const pago = await request.post(`${init_point}/pagar`, { maxRedirects: 0 });
  expect(pago.status()).toBe(303);
  const paymentId = new URL(pago.headers()['location']).searchParams.get(
    'payment_id'
  );
  expect(paymentId).toBeTruthy();

  expect((await enviarAvisoDePago(request, paymentId!)).status()).toBe(200);

  const tokenQr = leerQr(await esperarQrDelCorreo(request, email));
  return { email, tokenQr };
}
