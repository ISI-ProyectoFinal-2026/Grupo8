import { expect, test, type APIRequestContext } from '@playwright/test';
import { URL_BACKEND, URL_SERVICIOS_FALSOS } from './entorno';
import { crearReservaPagada } from './helpers/reservaPagada';
import { diasDesdeHoy } from './helpers/sesion';
import type { CorreoFalso } from './servicios-falsos';

/**
 * Sub-issue 25.3: botón de arrepentimiento sin cuenta.
 *
 * Un visitante con dos reservas pagadas del mismo email pide los enlaces desde el pie de la web,
 * abre el de una sola reserva y la cancela; la otra no cambia. Las reservas se crean por API y
 * son de hoy, así que están dentro del plazo de arrepentimiento (25.1) con cualquier configuración.
 */

const MENSAJE_SOLICITUD =
  'Si hay reservas con ese email, te enviamos un correo con un enlace para cada una.';

/** Enlace de cancelación de cada reserva, sacado del correo del botón de arrepentimiento. */
async function esperarEnlacesDelCorreo(
  request: APIRequestContext,
  email: string
): Promise<Record<string, string>> {
  let correo: CorreoFalso | undefined;
  // El correo sale en segundo plano después de responder la solicitud
  await expect
    .poll(
      async () => {
        const respuesta = await request.get(`${URL_SERVICIOS_FALSOS}/__e2e/correos`, {
          params: { para: email },
        });
        const correos = (await respuesta.json()) as CorreoFalso[];
        correo = correos.find((c) => /arrepentimiento/i.test(c.subject));
        return Boolean(correo);
      },
      { message: `No llegó el correo del botón de arrepentimiento a ${email}` }
    )
    .toBe(true);

  // Cada bloque del correo: "Reserva <id>" y después su botón con el enlace
  const enlaces: Record<string, string> = {};
  for (const [, reservaId, enlace] of correo!.html.matchAll(
    /Reserva ([0-9a-f-]{36})<\/strong>[\s\S]*?href="([^"]+)"/g
  )) {
    enlaces[reservaId] = enlace;
  }
  return enlaces;
}

const tokenDelEnlace = (enlace: string) => new URL(enlace).searchParams.get('token')!;

test('un visitante sin cuenta cancela una de sus dos reservas con el botón de arrepentimiento', async ({
  page,
  request,
}) => {
  const email = `arrepentimiento-${Date.now()}@example.com`;
  const { reservaId: cancelada } = await crearReservaPagada(request, ['Ana Arrepentida'], {
    fecha: diasDesdeHoy(3),
    email,
  });
  const { reservaId: otra } = await crearReservaPagada(request, ['Ana Arrepentida'], {
    fecha: diasDesdeHoy(5),
    email,
  });

  // Sin iniciar sesión: el enlace está en el pie de cualquier pantalla de la web
  await page.goto('/');
  await page.getByRole('link', { name: 'Botón de arrepentimiento' }).click();
  await expect(page).toHaveURL(/\/arrepentimiento$/);

  await page.getByLabel('Email de la reserva').fill(email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText(MENSAJE_SOLICITUD)).toBeVisible();

  // Un enlace distinto por reserva
  const enlaces = await esperarEnlacesDelCorreo(request, email);
  expect(Object.keys(enlaces).sort()).toEqual([cancelada, otra].sort());
  expect(enlaces[cancelada]).not.toBe(enlaces[otra]);

  // El enlace abre la pantalla con las condiciones de esa reserva
  await page.goto(enlaces[cancelada]);
  await expect(page.getByText('¿Está seguro que desea cancelar?')).toBeVisible();
  await expect(
    page.getByText('Estás dentro del plazo de arrepentimiento: se te devuelve el total.')
  ).toBeVisible();
  await expect(page.getByText('100 % de lo que pagaste')).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar cancelación' }).click();
  await expect(page.getByRole('heading', { name: 'Reserva cancelada' })).toBeVisible();
  await expect(page.getByText(/La reserva quedó cancelada\. Te devolvimos \$/)).toBeVisible();
  await expect(page.getByText('Código de gestión:', { exact: false })).toContainText(cancelada);

  // La otra reserva del mismo email no cambió: su enlace todavía permite cancelarla
  const condicionesOtra = await request.get(`${URL_BACKEND}/arrepentimiento/condiciones`, {
    params: { token: tokenDelEnlace(enlaces[otra]) },
  });
  expect(condicionesOtra.ok()).toBeTruthy();
  expect(await condicionesOtra.json()).toMatchObject({ puede_cancelar: true, mensaje: null });

  // Volver a abrir el enlace usado no permite cancelar otra vez
  await page.goto(enlaces[cancelada]);
  await expect(page.getByText('La reserva ya está cancelada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar cancelación' })).toHaveCount(0);
});
