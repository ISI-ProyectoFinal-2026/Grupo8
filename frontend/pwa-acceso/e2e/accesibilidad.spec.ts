import { expect, test, type Page } from '@playwright/test';
import { CREDENCIALES } from './entorno';
import { revisarAccesibilidad } from './helpers/accesibilidad';
import { barraDeOcupacion } from './helpers/panel';
import { LOGIN, hoyEnArgentina, iniciarSesion } from './helpers/sesion';

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

/** Reservas no se abre con la URL: necesita la búsqueda de Home, igual que en la 24.1. */
async function abrirReservas(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Fecha de ingreso').fill(hoyEnArgentina());
  await page.getByLabel(/Cantidad de personas/).fill('1');
  await page.getByRole('combobox', { name: 'Tipo de reserva' }).click();
  await page.getByRole('option', { name: /Entrada general/ }).click();
  await page.getByLabel(/Cantidad de noches/).fill('0');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
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
    nombre: 'Reservas',
    titulo: 'Completá tu reserva | Qamp',
    abrir: abrirReservas,
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
