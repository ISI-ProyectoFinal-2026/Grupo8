import { PUERTO_SERVICIOS_FALSOS } from './entorno';
import { iniciarServiciosFalsos } from './servicios-falsos';

/**
 * Corre una vez antes de todos los tests, en el proceso principal de Playwright.
 * Levanta Mercado Pago y Resend falsos; la función que devuelve los apaga al terminar.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const servidor = await iniciarServiciosFalsos(PUERTO_SERVICIOS_FALSOS);
  return () => new Promise<void>((resolve) => servidor.close(() => resolve()));
}
