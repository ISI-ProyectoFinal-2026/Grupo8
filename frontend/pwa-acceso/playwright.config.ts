import { defineConfig, devices } from '@playwright/test';
import {
  CARPETA_BACKEND,
  PUERTO_BACKEND,
  PUERTO_FRONTEND,
  URL_BACKEND,
  URL_FRONTEND,
  entornoBackend,
} from './e2e/entorno';

const enCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',

  // Todos los tests comparten una base y un único contador de ocupación:
  // corren de a uno para que un test no mueva los números de otro
  fullyParallel: false,
  workers: 1,
  forbidOnly: enCI,
  retries: enCI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },

  reporter: enCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: URL_FRONTEND,
    locale: 'es-AR',
    // Las fechas de las reservas se calculan con la hora de Argentina
    timezoneId: 'America/Argentina/Buenos_Aires',
    // Se prueba la PWA compilada: el service worker solo existe en el build.
    // Lo necesitan las pruebas sin conexión (24.2), que usan context.setOffline(true)
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Playwright levanta cada servidor, espera a que su URL responda y los apaga al terminar.
  // No se reutilizan servidores ya encendidos: cada corrida arranca con la base recién preparada
  webServer: [
    {
      name: 'backend',
      // Primero vacía y migra la base _e2e, después levanta FastAPI en el puerto de pruebas
      command: `pipenv run python e2e_preparar_db.py && pipenv run uvicorn main:app --port ${PUERTO_BACKEND}`,
      cwd: CARPETA_BACKEND,
      url: `${URL_BACKEND}/health`,
      env: entornoBackend(),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      name: 'frontend',
      // Build de producción servido con vite preview, apuntando al backend de pruebas
      command: `npm run build && npx vite preview --port ${PUERTO_FRONTEND} --strictPort`,
      url: URL_FRONTEND,
      env: { VITE_API_URL: URL_BACKEND },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
