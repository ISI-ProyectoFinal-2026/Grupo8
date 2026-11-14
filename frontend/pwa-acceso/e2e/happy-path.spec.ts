import { expect, test, type Page } from '@playwright/test';
import { CREDENCIALES } from './entorno';
import { enviarAvisoDePago } from './helpers/mercadoPago';
import { esperarQrDelCorreo, leerQr } from './helpers/qr';
import { hoyEnArgentina, iniciarSesion } from './helpers/sesion';

/**
 * Sub-issue 24.1: recorrido feliz completo, con tres personas distintas en tres navegadores:
 * el cliente (reserva y paga), el guardia (escanea el QR) y el administrador (mira la ocupación
 * y registra el egreso). Cada uno tiene su propio contexto: sesión, localStorage e IndexedDB separados.
 */

const PERSONAS = 2;
const NOMBRES = ['Ana Prueba', 'Bruno Prueba'];

/** La barra del monitor del panel expone la ocupación en aria-valuenow. */
const barraDeOcupacion = (panel: Page) =>
  panel.getByRole('progressbar', { name: 'Ocupación del camping' });

test('reserva, pago, QR, ingreso y egreso: la ocupación del panel sube y vuelve a bajar', async ({
  page: cliente,
  browser,
  request,
}) => {
  const email = `cliente-${Date.now()}@example.com`;

  // --- Administrador: ocupación de partida -------------------------------------------------
  const contextoAdmin = await browser.newContext();
  const panel = await contextoAdmin.newPage();
  await iniciarSesion(panel, CREDENCIALES.admin);
  await panel.goto('/admin');
  await expect(barraDeOcupacion(panel)).toBeVisible();
  // Se compara contra el valor inicial y no contra 0: el test sigue sirviendo si hay datos previos
  const ocupacionInicial = Number(
    await barraDeOcupacion(panel).getAttribute('aria-valuenow')
  );

  await test.step('el cliente busca disponibilidad y completa la reserva', async () => {
    await cliente.goto('/');
    await cliente.getByLabel('Fecha de ingreso').fill(hoyEnArgentina());
    await cliente.getByLabel(/Cantidad de personas/).fill(String(PERSONAS));
    await cliente.getByRole('combobox', { name: 'Tipo de reserva' }).click();
    await cliente.getByRole('option', { name: /Entrada general/ }).click();
    await cliente.getByLabel(/Cantidad de noches/).fill('0');
    await cliente
      .getByRole('button', { name: 'Continuar', exact: true })
      .click();

    await cliente
      .getByRole('button', { name: 'Continuar con la reserva' })
      .click();
    await expect(
      cliente.getByRole('heading', { name: 'Completá tu Reserva' })
    ).toBeVisible();

    await cliente.getByLabel('Email de contacto').fill(email);
    await cliente.getByLabel('Confirmar correo electrónico').fill(email);
    for (const [i, nombre] of NOMBRES.entries()) {
      // Hay un formulario por visitante con las mismas etiquetas: se elige por orden
      await cliente
        .getByLabel('Nombre completo', { exact: true })
        .nth(i)
        .fill(nombre);
      await cliente.getByLabel('Edad', { exact: true }).nth(i).fill('30');
    }
    await cliente
      .getByRole('button', { name: 'Pagar con Mercado Pago' })
      .click();
    await expect(cliente.getByText('Tu reserva está guardada')).toBeVisible();
  });

  const paymentId =
    await test.step('el cliente paga en Mercado Pago (simulado)', async () => {
      await cliente.getByRole('button', { name: 'Ir a pagar' }).click();

      // Pantalla del Mercado Pago falso (otro origen, igual que el checkout real)
      await expect(
        cliente.getByRole('heading', { name: 'Mercado Pago (simulado)' })
      ).toBeVisible();
      await cliente.getByRole('button', { name: 'Pagar' }).click();

      // Mercado Pago devuelve al cliente a back_urls.success con el id del pago en la URL
      await expect(cliente.getByText('¡Reserva Realizada!')).toBeVisible();
      const id = new URL(cliente.url()).searchParams.get('payment_id');
      expect(id, 'Mercado Pago tiene que volver con payment_id').toBeTruthy();
      return id!;
    });

  await test.step('llega el aviso firmado de Mercado Pago (webhook)', async () => {
    const respuesta = await enviarAvisoDePago(request, paymentId);
    // El webhook siempre responde 200 (salvo firma inválida, 401): la confirmación real
    // se comprueba en el paso siguiente, porque el correo con el QR solo sale si la reserva quedó pagada
    expect(respuesta.status()).toBe(200);
  });

  const tokenQr =
    await test.step('el cliente recibe el QR por correo', async () => {
      const png = await esperarQrDelCorreo(request, email);
      return leerQr(png);
    });

  await test.step('el guardia escanea el QR y el ingreso se sincroniza', async () => {
    const contextoGuardia = await browser.newContext();
    const guardia = await contextoGuardia.newPage();
    // Reloj controlable: la PWA sincroniza cada 5 minutos y el test adelanta ese tiempo
    await guardia.clock.install();
    await iniciarSesion(guardia, CREDENCIALES.guardia);
    await guardia.goto('/acceso');

    await guardia.getByRole('button', { name: /Escanear QR/ }).click();
    // Sin cámara en el navegador de pruebas: se usa el ingreso manual del mismo componente,
    // que llama a la misma validación (onScanSuccess) con el texto que leería la cámara
    await guardia.getByRole('textbox', { name: 'Token del QR' }).fill(tokenQr);
    await guardia.getByRole('button', { name: 'Validar' }).click();
    await expect(
      guardia.getByRole('heading', { name: /INGRESO CONFIRMADO/ })
    ).toBeVisible();

    // El ingreso quedó en IndexedDB; el envío al backend sale con el intervalo de 5 minutos
    await guardia.clock.fastForward('05:00');
    await expect(guardia.getByText(/Datos Actualizados/)).toBeVisible();
    await contextoGuardia.close();
  });

  await test.step('la ocupación del panel sube', async () => {
    // El monitor se actualiza solo cada 30 s: se recarga para no esperar
    await expect(async () => {
      await panel.reload();
      await expect(barraDeOcupacion(panel)).toHaveAttribute(
        'aria-valuenow',
        String(ocupacionInicial + PERSONAS),
        {
          timeout: 2_000,
        }
      );
    }).toPass({ timeout: 30_000 });
  });

  await test.step('el administrador registra el egreso y la ocupación baja', async () => {
    await panel.getByRole('link', { name: 'Egresos', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Egresos' })).toBeVisible();
    await panel.getByLabel('Personas que salen').fill(String(PERSONAS));
    await panel.getByRole('button', { name: 'Registrar egreso' }).click();

    await expect(
      panel.getByText(`Se registró el egreso de ${PERSONAS} personas.`)
    ).toBeVisible();
    await expect(barraDeOcupacion(panel)).toHaveAttribute(
      'aria-valuenow',
      String(ocupacionInicial)
    );
  });

  await contextoAdmin.close();
});
