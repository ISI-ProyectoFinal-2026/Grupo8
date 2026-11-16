import { expect, test, type Page } from '@playwright/test';
import { CREDENCIALES } from './entorno';
import { revisarAccesibilidad } from './helpers/accesibilidad';
import { barraDeOcupacion } from './helpers/panel';
import { crearReservaPagada } from './helpers/reservaPagada';
import {
  LOGIN,
  hoyEnArgentina,
  iniciarSesion,
  tokenPorApi,
} from './helpers/sesion';

/**
 * Sub-issue 27.1: revisión automática de accesibilidad (WCAG 2.2 AA) con axe en las pantallas
 * principales de las tres apps. Cada prueba abre la pantalla como lo haría una persona,
 * comprueba el título de la pestaña y corre axe cuando la pantalla terminó de cargar.
 *
 * Las pantallas que todavía no están integradas quedan marcadas con `pendiente` y Playwright
 * las saltea (test.fixme). Cuando se integra la sub-issue, se borra esa línea.
 */

type Actor = 'socio' | 'guardia' | 'admin';

const LOGIN_DE: Record<Actor, (typeof LOGIN)[keyof typeof LOGIN]> = {
  socio: LOGIN.cliente,
  guardia: LOGIN.guardia,
  admin: LOGIN.admin,
};

interface Pantalla {
  nombre: string;
  /** Quién tiene que iniciar sesión antes. Sin actor, la pantalla es pública. */
  actor?: Actor;
  titulo: string;
  /** Abre la pantalla y espera a que muestre su contenido principal. */
  abrir: (page: Page) => Promise<void>;
  /** Sub-issue que crea la pantalla, si todavía no está integrada. */
  pendiente?: string;
}

/** Disponibilidad no se abre con la URL: necesita la búsqueda de Home, igual que en la 24.1. */
async function abrirDisponibilidad(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Fecha de ingreso').fill(hoyEnArgentina());
  await page.getByLabel(/Cantidad de personas/).fill('1');
  await page.getByRole('combobox', { name: 'Tipo de reserva' }).click();
  await page.getByRole('option', { name: /Entrada general/ }).click();
  await page.getByLabel(/Cantidad de noches/).fill('0');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continuar con la reserva' })
  ).toBeVisible();
}

async function abrirReservas(page: Page): Promise<void> {
  await abrirDisponibilidad(page);
  await page.getByRole('button', { name: 'Continuar con la reserva' }).click();
  await expect(
    page.getByRole('heading', { name: 'Completá tu Reserva' })
  ).toBeVisible();
}

const PANTALLAS: Pantalla[] = [
  // --- Web de reservas ---------------------------------------------------------------------
  {
    nombre: 'Home',
    titulo: 'Inicio | Qamp',
    abrir: async (page) => {
      await page.goto('/');
      await expect(page.getByLabel('Fecha de ingreso')).toBeVisible();
    },
  },
  {
    nombre: 'Disponibilidad',
    titulo: 'Disponibilidad | Qamp',
    abrir: abrirDisponibilidad,
  },
  {
    nombre: 'Reservas',
    titulo: 'Completá tu reserva | Qamp',
    abrir: abrirReservas,
  },
  {
    // Los mensajes de error también tienen que cumplir (contraste, asociación con el campo)
    nombre: 'Reservas con errores',
    titulo: 'Completá tu reserva | Qamp',
    abrir: async (page) => {
      await abrirReservas(page);
      await page
        .getByRole('button', { name: 'Pagar con Mercado Pago' })
        .click();
      await expect(page.getByRole('alert').first()).toBeVisible();
    },
  },
  {
    nombre: 'Iniciar sesión',
    titulo: 'Iniciar sesión | Qamp',
    abrir: async (page) => {
      await page.goto('/login');
      await expect(page.getByLabel('DNI o Email')).toBeVisible();
    },
  },
  {
    nombre: 'Mi perfil',
    actor: 'socio',
    titulo: 'Mi perfil | Qamp',
    abrir: async (page) => {
      await page.goto('/perfil');
      await expect(
        page.getByRole('heading', { name: 'Mi Perfil', level: 1 })
      ).toBeVisible();
    },
  },
  {
    nombre: 'Beneficios',
    titulo: 'Beneficios | Qamp',
    abrir: async (page) => {
      await page.goto('/beneficios');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    },
  },
  {
    nombre: 'Acerca de',
    titulo: 'Acerca de | Qamp',
    abrir: async (page) => {
      await page.goto('/acerca');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    },
  },
  {
    nombre: 'Contacto',
    titulo: 'Contacto | Qamp',
    abrir: async (page) => {
      await page.goto('/contacto');
      await expect(page.getByLabel('Mensaje')).toBeVisible();
    },
  },
  {
    nombre: 'Mis reservas',
    actor: 'socio',
    titulo: 'Mis reservas | Qamp',
    abrir: async (page) => {
      await page.goto('/mis-reservas');
      await expect(page.getByRole('tab', { name: 'Próximas' })).toBeVisible();
    },
  },
  {
    nombre: 'Botón de arrepentimiento',
    titulo: 'Botón de arrepentimiento | Qamp',
    pendiente: '25.3',
    abrir: async (page) => {
      await page.goto('/arrepentimiento');
      await expect(
        page.getByRole('button', { name: 'Enviar enlace' })
      ).toBeVisible();
    },
  },

  // --- Panel de administración -------------------------------------------------------------
  {
    nombre: 'Inicio del panel',
    actor: 'admin',
    titulo: 'Inicio | Qamp Panel',
    abrir: async (page) => {
      await page.goto('/admin');
      await expect(barraDeOcupacion(page)).toBeVisible();
    },
  },
  {
    nombre: 'Gestión de reservas',
    actor: 'admin',
    titulo: 'Gestión de reservas | Qamp Panel',
    abrir: async (page) => {
      await page.goto('/admin/reservas');
      await expect(
        page.getByRole('heading', { name: 'Gestión de reservas', level: 1 })
      ).toBeVisible();
    },
  },
  {
    nombre: 'Historial de ingresos',
    actor: 'admin',
    titulo: 'Historial de ingresos | Qamp Panel',
    pendiente: '26.6',
    abrir: async (page) => {
      await page.goto('/admin/historial-ingresos');
      await expect(
        page.getByRole('heading', { name: 'Historial de ingresos', level: 1 })
      ).toBeVisible();
    },
  },

  // --- PWA del guardia ---------------------------------------------------------------------
  {
    nombre: 'Escáner',
    actor: 'guardia',
    titulo: 'Escáner | Qamp Acceso',
    abrir: async (page) => {
      await page.goto('/acceso');
      // La capacidad aparece cuando terminó la descarga inicial (bootstrap)
      await expect(page.getByText('Capacidad Disponible')).toBeVisible();
    },
  },
  {
    nombre: 'Historial de la PWA',
    actor: 'guardia',
    titulo: 'Historial | Qamp Acceso',
    abrir: async (page) => {
      await page.goto('/acceso/historial');
      await expect(
        page.getByRole('heading', { name: 'Historial', level: 1 })
      ).toBeVisible();
    },
  },
];

test.describe('Accesibilidad (axe, WCAG 2.2 AA)', () => {
  for (const pantalla of PANTALLAS) {
    test(pantalla.nombre, async ({ page }, testInfo) => {
      test.fixme(
        Boolean(pantalla.pendiente),
        `La pantalla llega con la sub-issue ${pantalla.pendiente}`
      );

      if (pantalla.actor) {
        await iniciarSesion(
          page,
          LOGIN_DE[pantalla.actor],
          CREDENCIALES[pantalla.actor]
        );
      }
      await pantalla.abrir(page);

      // WCAG 2.4.2: cada pantalla tiene su propio título en la pestaña
      await expect(page).toHaveTitle(pantalla.titulo);
      await revisarAccesibilidad(page, testInfo);
    });
  }
});

// =========================================================================================
// Sub-issue 27.2: la web de reservas se usa solo con teclado
// =========================================================================================
test.describe('Teclado en la web de reservas', () => {
  test('el primer Tab ofrece "Saltar al contenido" y lleva el foco al contenido', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByLabel('Fecha de ingreso')).toBeVisible();

    await page.keyboard.press('Tab');
    const saltar = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(saltar).toBeFocused();
    await expect(saltar).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
  });

  test('al enviar con errores, el foco va al primer campo y el campo describe su error', async ({
    page,
  }) => {
    await abrirReservas(page);
    await page.getByRole('button', { name: 'Pagar con Mercado Pago' }).click();

    const email = page.getByLabel('Email de contacto');
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAccessibleDescription(/.+/);
  });

  test('el diálogo de cancelación encierra el foco y lo devuelve al cerrar', async ({
    page,
    request,
  }) => {
    const tokenSocio = await tokenPorApi(request, CREDENCIALES.socio);
    const { reservaId } = await crearReservaPagada(request, ['Teo Teclado'], {
      tokenSocio,
    });

    await iniciarSesion(page, LOGIN.cliente, CREDENCIALES.socio);
    await page.goto('/mis-reservas');
    await page.getByRole('tab', { name: 'Próximas' }).click();
    const cancelar = page
      .getByRole('article', { name: `Reserva ${reservaId.slice(0, 8)}` })
      .getByRole('button', { name: 'Cancelar' });

    // Se abre con el teclado
    await cancelar.focus();
    await page.keyboard.press('Enter');
    const dialogo = page.getByRole('dialog', { name: 'Cancelar reserva' });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByRole('button', { name: 'Volver' })).toBeVisible();

    // Con Tab el foco no sale del diálogo
    const focoAdentro = () =>
      dialogo.evaluate((nodo) => nodo.contains(document.activeElement));
    await expect.poll(focoAdentro).toBe(true);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await focoAdentro()).toBe(true);
    }

    // Esc lo cierra y el foco vuelve al botón que lo abrió
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    await expect(cancelar).toBeFocused();
  });
});
