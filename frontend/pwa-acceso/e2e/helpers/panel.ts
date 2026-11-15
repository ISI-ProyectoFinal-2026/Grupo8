import { expect, type Page } from '@playwright/test';

/** La barra del monitor expone la ocupación en aria-valuenow. */
export const barraDeOcupacion = (panel: Page) =>
  panel.getByRole('progressbar', { name: 'Ocupación del camping' });

/** El total de efectivo del resumen de cobros ("$3.500" → 3500). */
export const totalEfectivo = (panel: Page) =>
  panel.getByRole('group', { name: 'Efectivo' }).getByRole('definition');

export async function leerOcupacion(panel: Page): Promise<number> {
  await expect(barraDeOcupacion(panel)).toBeVisible();
  return Number(await barraDeOcupacion(panel).getAttribute('aria-valuenow'));
}

/** Convierte un monto con formato argentino ("$1.234,5") a número. */
export function montoANumero(texto: string): number {
  return Number(texto.replace(/[^\d,]/g, '').replace(',', '.'));
}

export async function leerEfectivo(panel: Page): Promise<number> {
  await expect(totalEfectivo(panel)).toBeVisible();
  return montoANumero(await totalEfectivo(panel).innerText());
}
