import { expect, test, type Page, type Response } from '@playwright/test';
import { CREDENCIALES, URL_BACKEND } from './entorno';
import { fijarReglasDeCancelacion } from './helpers/configuracion';
import { barraDeOcupacion, leerOcupacion } from './helpers/panel';
import { crearReservaPagada } from './helpers/reservaPagada';
import {
  LOGIN,
  diasDesdeHoy,
  hoyEnArgentina,
  iniciarSesion,
  tokenPorApi,
} from './helpers/sesion';

/**
 * Sub-issue 24.3: cancelación de reservas (Issue 22) y rechazo del QR cancelado en la puerta.
 *
 * El plazo lo decide el backend con su propia fecha (hora de Argentina), no el navegador.
 * Por eso no se manipula el reloj: se fija el plazo N y se crean reservas con fechas relativas
 * a hoy, justo en el límite del plazo (análisis de valores límite).
 */

const PLAZO_DIAS = 3;
const MENSAJE_FUERA_DE_PLAZO = `Lo sentimos, las reservas solo se pueden cancelar hasta ${PLAZO_DIAS} días antes del ingreso.`;

/** Cada tarjeta de Mis reservas se anuncia como "Reserva <primeros 8 caracteres del id>". */
const tarjetaDeReserva = (page: Page, reservaId: string) =>
  page.getByRole('article', { name: `Reserva ${reservaId.slice(0, 8)}` });

/** Abre el diálogo de cancelación de una reserva desde Mis reservas (pestaña Próximas). */
async function abrirCancelacion(page: Page, reservaId: string) {
  await page.goto('/mis-reservas');
  // La pestaña inicial es "Pendientes": las reservas pagadas y por venir están en "Próximas"
  await page.getByRole('tab', { name: 'Próximas' }).click();
  await tarjetaDeReserva(page, reservaId)
    .getByRole('button', { name: 'Cancelar' })
    .click();
  const dialogo = page.getByRole('dialog', { name: 'Cancelar reserva' });
  await expect(dialogo).toBeVisible();
  return dialogo;
}

/** Primera página del bootstrap del guardia: trae la capacidad y la lista de reservas canceladas. */
const esBootstrap = (respuesta: Response) =>
  respuesta
    .url()
    .startsWith(`${URL_BACKEND}/api/v1/sincronizacion/bootstrap?page=1`);

// =========================================================================================
// Bloque 1: reglas de negocio de tiempo
// =========================================================================================
test.describe('Bloque 1: plazo de cancelación', () => {
  test.beforeEach(async ({ request }) => {
    await fijarReglasDeCancelacion(request, {
      dias: PLAZO_DIAS,
      porcentaje: 50,
    });
  });

  test(`el socio cancela el último día del plazo (ingreso dentro de ${PLAZO_DIAS} días) y ve la confirmación`, async ({
    page,
    request,
  }) => {
    // Valor límite: hoy es el último día en que se puede cancelar
    const tokenSocio = await tokenPorApi(request, CREDENCIALES.socio);
    const { reservaId } = await crearReservaPagada(request, ['Fede Plazo'], {
      fecha: diasDesdeHoy(PLAZO_DIAS),
      tokenSocio,
    });

    await iniciarSesion(page, LOGIN.cliente, CREDENCIALES.socio);
    const dialogo = await abrirCancelacion(page, reservaId);

    await expect(dialogo.getByText('50 % de lo que pagaste')).toBeVisible();
    await expect(
      dialogo.getByText('¿Está seguro que desea cancelar?')
    ).toBeVisible();
    await dialogo
      .getByRole('button', { name: 'Confirmar cancelación' })
      .click();

    // El diálogo se cierra y queda el mensaje del backend con la devolución parcial
    await expect(dialogo).toBeHidden();
    await expect(
      page.getByRole('status').filter({
        hasText:
          /La reserva quedó cancelada\. Te devolvimos \$ [\d.,]+ por Mercado Pago\./,
      })
    ).toBeVisible();

    // La reserva pasa a Canceladas
    await expect(tarjetaDeReserva(page, reservaId)).toHaveCount(0);
    await page.getByRole('tab', { name: 'Canceladas' }).click();
    await expect(tarjetaDeReserva(page, reservaId)).toBeVisible();
    await expect(
      tarjetaDeReserva(page, reservaId).getByText('CANCELADA')
    ).toBeVisible();
  });

  test('un día después del plazo ve el mensaje "Lo sentimos…" y no puede confirmar', async ({
    page,
    request,
  }) => {
    // Valor límite: el plazo venció ayer (ingreso dentro de N - 1 días)
    const tokenSocio = await tokenPorApi(request, CREDENCIALES.socio);
    const { reservaId } = await crearReservaPagada(request, ['Gise Tarde'], {
      fecha: diasDesdeHoy(PLAZO_DIAS - 1),
      tokenSocio,
    });

    await iniciarSesion(page, LOGIN.cliente, CREDENCIALES.socio);
    const dialogo = await abrirCancelacion(page, reservaId);

    // Texto exacto que pide el criterio, anunciado como alerta para los lectores de pantalla
    await expect(
      dialogo.getByText(MENSAJE_FUERA_DE_PLAZO, { exact: true })
    ).toBeVisible();
    await expect(dialogo.getByRole('alert')).toHaveText(MENSAJE_FUERA_DE_PLAZO);
    await expect(
      dialogo.getByRole('button', { name: 'Confirmar cancelación' })
    ).toHaveCount(0);

    // La regla no es solo de pantalla: el backend también rechaza la cancelación directa
    const directa = await request.post(
      `${URL_BACKEND}/reservas/${reservaId}/cancelar`,
      {
        headers: { Authorization: `Bearer ${tokenSocio}` },
      }
    );
    expect(directa.status()).toBe(422);
    expect(((await directa.json()) as { detail: string }).detail).toBe(
      MENSAJE_FUERA_DE_PLAZO
    );

    // Al volver, la reserva sigue en Próximas
    await dialogo.getByRole('button', { name: 'Volver' }).click();
    await expect(tarjetaDeReserva(page, reservaId)).toBeVisible();
  });
});

// =========================================================================================
// Bloque 2: de la nube a la puerta sin internet
// =========================================================================================
test('Bloque 2: el QR de una reserva cancelada se rechaza en la puerta sin internet', async ({
  browser,
  request,
}) => {
  // Con plazo 0 se puede cancelar el mismo día: el socio cancela una reserva de hoy y alguien
  // intenta entrar igual con el QR. Al ser de hoy, el QR solo puede rechazarse por estar cancelado
  await fijarReglasDeCancelacion(request, { dias: 0, porcentaje: 100 });
  const tokenSocio = await tokenPorApi(request, CREDENCIALES.socio);
  const { reservaId, tokenQr } = await crearReservaPagada(
    request,
    ['Ivo Cancelado', 'Juli Cancelada'],
    { fecha: hoyEnArgentina(), tokenSocio }
  );

  // Un contexto por persona: cada uno con su propia sesión, localStorage e IndexedDB
  const contextoAdmin = await browser.newContext();
  const panel = await contextoAdmin.newPage();
  await iniciarSesion(panel, LOGIN.admin, CREDENCIALES.admin);
  await panel.goto('/admin');
  const ocupacionInicial = await leerOcupacion(panel);

  await test.step('A. el socio cancela la reserva desde la web', async () => {
    const contextoSocio = await browser.newContext();
    const socio = await contextoSocio.newPage();
    await iniciarSesion(socio, LOGIN.cliente, CREDENCIALES.socio);
    const dialogo = await abrirCancelacion(socio, reservaId);
    await dialogo
      .getByRole('button', { name: 'Confirmar cancelación' })
      .click();
    await expect(
      socio
        .getByRole('status')
        .filter({ hasText: 'La reserva quedó cancelada.' })
    ).toBeVisible();
    // El socio termina: su sesión no puede filtrarse a la del guardia
    await contextoSocio.close();
  });

  const contextoGuardia = await browser.newContext();
  const guardia = await contextoGuardia.newPage();
  const enviosBulkSync: string[] = [];
  guardia.on('request', (pedido) => {
    if (pedido.url().endsWith('/api/v1/ingresos/bulk-sync'))
      enviosBulkSync.push(pedido.url());
  });

  await test.step('B. el guardia abre la app y descarga la lista de canceladas', async () => {
    // La espera se arma antes de abrir la app: la descarga empieza apenas se monta la pantalla
    const bootstrap = guardia.waitForResponse(esBootstrap);
    await iniciarSesion(guardia, LOGIN.guardia, CREDENCIALES.guardia);
    const respuesta = await bootstrap;
    expect(respuesta.status()).toBe(200);
    const cuerpo = (await respuesta.json()) as { blacklist: string[] };
    expect(
      cuerpo.blacklist,
      'El servidor tiene que mandar la reserva cancelada'
    ).toContain(reservaId);
    // La capacidad se muestra recién cuando terminó todo el bootstrap, lista incluida
    // (contexto nuevo: no hay capacidad guardada de antes que pueda aparecer primero)
    await expect(guardia.getByText('Capacidad Disponible')).toBeVisible();
  });

  const lugares = guardia.getByRole('heading', { name: /^\d+ \/ \d+$/ });
  const lugaresAntes = await lugares.innerText();

  await test.step('C. el guardia pierde internet', async () => {
    await contextoGuardia.setOffline(true);
    await expect
      .poll(() => guardia.evaluate(() => navigator.onLine))
      .toBe(false);
  });

  await test.step('D. escanea el QR cancelado: se rechaza y no se registra el ingreso', async () => {
    await guardia.getByRole('button', { name: /Escanear QR/ }).click();
    await guardia.getByRole('textbox', { name: 'Token del QR' }).fill(tokenQr);
    await guardia.getByRole('button', { name: 'Validar' }).click();

    // El mensaje de "cancelada" es distinto del de "QR inválido": la firma era buena y el
    // rechazo vino de la lista descargada
    await expect(
      guardia.getByRole('heading', {
        name: 'Reserva Cancelada / Acceso Revocado',
      })
    ).toBeVisible();
    await expect(
      guardia.getByRole('heading', { name: /INGRESO CONFIRMADO/ })
    ).toHaveCount(0);
    await expect(lugares).toHaveText(lugaresAntes);
  });

  await test.step('E. al volver internet no se envía ningún ingreso y el panel no cambia', async () => {
    // Al reconectar la app vuelve a descargar el bootstrap y sincroniza lo pendiente (nada)
    const bootstrap = guardia.waitForResponse(esBootstrap);
    await contextoGuardia.setOffline(false);
    await bootstrap;
    expect(
      enviosBulkSync,
      'No había ingresos pendientes para enviar'
    ).toHaveLength(0);

    await panel.reload();
    await expect(barraDeOcupacion(panel)).toHaveAttribute(
      'aria-valuenow',
      String(ocupacionInicial)
    );
  });

  await contextoGuardia.close();
  await contextoAdmin.close();
});
