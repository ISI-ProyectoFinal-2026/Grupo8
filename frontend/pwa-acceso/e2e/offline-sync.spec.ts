import { expect, test, type Response } from '@playwright/test';
import { CREDENCIALES, URL_BACKEND } from './entorno';
import {
  barraDeOcupacion,
  leerEfectivo,
  leerOcupacion,
  totalEfectivo,
  montoANumero,
} from './helpers/panel';
import { crearReservaPagada } from './helpers/reservaPagada';
import { LOGIN, iniciarSesion } from './helpers/sesion';

/**
 * Sub-issue 24.2: el guardia pierde internet, sigue trabajando y al volver la conexión
 * todo llega al panel.
 *
 * Solo el navegador del guardia queda sin red (context.setOffline). El backend sigue encendido
 * y el panel del administrador sigue conectado, igual que en la realidad: lo que se corta es
 * el 4G del celular de la puerta, no el servidor.
 */

const PERSONAS_RESERVA = ['Carla Offline', 'Dario Offline'];
const MANUAL = {
  dni: '30111222',
  nombre: 'Elena Efectivo',
  acompanantes: 1,
  monto: 3500,
};
const PERSONAS_MANUAL = MANUAL.acompanantes + 1;
const PERSONAS_TOTALES = PERSONAS_RESERVA.length + PERSONAS_MANUAL;

/** La respuesta del envío en lote de ingresos que hace la PWA al reconectarse. */
const esBulkSync = (respuesta: Response) =>
  respuesta.url() === `${URL_BACKEND}/api/v1/ingresos/bulk-sync` &&
  respuesta.request().method() === 'POST';

test('sin conexión el guardia registra un QR y un ingreso en efectivo; al reconectar llegan al panel', async ({
  browser,
  request,
}) => {
  // --- 1. Estado inicial (con conexión) ---------------------------------------------------
  // La reserva se arma por API: el pago por pantalla ya lo cubre la 24.1
  const { tokenQr } = await crearReservaPagada(request, PERSONAS_RESERVA);

  const contextoAdmin = await browser.newContext();
  const panel = await contextoAdmin.newPage();
  await iniciarSesion(panel, LOGIN.admin, CREDENCIALES.admin);
  await panel.goto('/admin');
  const ocupacionInicial = await leerOcupacion(panel);
  const efectivoInicial = await leerEfectivo(panel);

  // El guardia abre la app con internet, como al empezar el turno: descarga la capacidad,
  // la lista de QR cancelados y deja instalado el service worker
  const contextoGuardia = await browser.newContext();
  const guardia = await contextoGuardia.newPage();
  await iniciarSesion(guardia, LOGIN.guardia, CREDENCIALES.guardia);
  await expect(guardia).toHaveURL(/\/acceso$/);
  await expect(guardia.getByText('Capacidad Disponible')).toBeVisible();
  await guardia.evaluate(() => navigator.serviceWorker.ready);

  // Registro de cada envío al backend: sirve para comprobar que sin red no sale nada
  const enviosBulkSync: string[] = [];
  guardia.on('request', (pedido) => {
    if (pedido.url().endsWith('/api/v1/ingresos/bulk-sync'))
      enviosBulkSync.push(pedido.url());
  });

  // --- 2. Se corta internet (solo en el celular del guardia) ----------------------------
  await contextoGuardia.setOffline(true);
  await expect.poll(() => guardia.evaluate(() => navigator.onLine)).toBe(false);

  await test.step('la app abre igual sin conexión (service worker)', async () => {
    await guardia.reload();
    await expect(
      guardia.getByRole('heading', { name: 'Control de acceso', level: 1 })
    ).toBeVisible();
  });

  // --- 3. Acciones sin conexión ------------------------------------------------------------
  await test.step('escanea el QR de una reserva pagada', async () => {
    await guardia.getByRole('button', { name: /Escanear QR/ }).click();
    // Mismo bypass que la 24.1: el texto del QR entra por el campo manual del escáner
    await guardia.getByRole('textbox', { name: 'Token del QR' }).fill(tokenQr);
    await guardia.getByRole('button', { name: 'Validar' }).click();
    // La firma del QR se valida en el celular con la clave pública: no hace falta el servidor
    await expect(
      guardia.getByRole('heading', { name: /INGRESO CONFIRMADO/ })
    ).toBeVisible();
    await expect(
      guardia.getByText(`Personas Ingresadas: ${PERSONAS_RESERVA.length}`)
    ).toBeVisible();
  });

  await test.step('registra un ingreso manual cobrado en efectivo', async () => {
    // El registro manual se abre desde la barra inferior de la app
    await guardia.getByRole('link', { name: 'Registro manual' }).click();
    await guardia.getByLabel('DNI / Pasaporte').fill(MANUAL.dni);
    await guardia.getByLabel('Nombre completo').fill(MANUAL.nombre);
    await guardia.getByLabel('Acompañantes').fill(String(MANUAL.acompanantes));
    await guardia
      .getByLabel('Tipo de Ingreso')
      .selectOption({ label: 'Espontáneo (Sin reserva)' });
    await guardia
      .getByLabel(/Monto cobrado en efectivo/)
      .fill(String(MANUAL.monto));
    await guardia.getByRole('button', { name: 'Guardar Ingreso' }).click();

    await expect(
      guardia.getByRole('heading', { name: /INGRESO MANUAL REGISTRADO/ })
    ).toBeVisible();
    await expect(
      guardia.getByText(`Monto cobrado: $${MANUAL.monto.toFixed(2)}`)
    ).toBeVisible();
  });

  await test.step('mientras no hay red, nada llegó al servidor', async () => {
    expect(
      enviosBulkSync,
      'Sin conexión la app no debería intentar sincronizar'
    ).toHaveLength(0);
    // El panel (que sí tiene red) sigue mostrando los valores de partida
    await panel.reload();
    await expect(barraDeOcupacion(panel)).toHaveAttribute(
      'aria-valuenow',
      String(ocupacionInicial)
    );
    expect(await leerEfectivo(panel)).toBe(efectivoInicial);
  });

  // --- 4. Vuelve internet y se sincroniza -------------------------------------------------
  await test.step('al volver la conexión los ingresos se envían en un lote', async () => {
    // La espera se arma ANTES de reconectar: si la respuesta llega muy rápido no se pierde
    const respuestaSync = guardia.waitForResponse(esBulkSync);
    await contextoGuardia.setOffline(false);
    const respuesta = await respuestaSync;

    expect(respuesta.status()).toBe(200);
    const enviado = respuesta.request().postDataJSON() as {
      ingresos: { monto_cobrado?: number }[];
    };
    const recibido = (await respuesta.json()) as {
      sincronizados_jti: string[];
      errores: unknown[];
    };
    expect(enviado.ingresos).toHaveLength(2);
    expect(enviado.ingresos.some((i) => i.monto_cobrado === MANUAL.monto)).toBe(
      true
    );
    expect(recibido.sincronizados_jti).toHaveLength(2);
    expect(recibido.errores).toHaveLength(0);

    await expect(guardia.getByText(/Datos Actualizados/)).toBeVisible();
  });

  // --- 5. El panel refleja lo registrado sin conexión ------------------------------------
  await test.step('el panel muestra la ocupación y el efectivo actualizados', async () => {
    // El backend ya confirmó (200 con los dos jti): con recargar alcanza, no hay que esperar tiempos fijos
    await panel.reload();
    await expect(barraDeOcupacion(panel)).toHaveAttribute(
      'aria-valuenow',
      String(ocupacionInicial + PERSONAS_TOTALES)
    );
    await expect(totalEfectivo(panel)).toBeVisible();
    expect(montoANumero(await totalEfectivo(panel).innerText())).toBe(
      efectivoInicial + MANUAL.monto
    );
  });

  await contextoGuardia.close();
  await contextoAdmin.close();
});
