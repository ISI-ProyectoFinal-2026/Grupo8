import { expect, type Page } from '@playwright/test';

/** Inicia sesión desde la pantalla de login, igual que una persona. */
export async function iniciarSesion(
  page: Page,
  credenciales: { email: string; password: string }
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('DNI o Email').fill(credenciales.email);
  await page.getByLabel('Contraseña').fill(credenciales.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Fecha de hoy en Argentina con formato YYYY-MM-DD (el que usa el input de fecha). */
export function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}
