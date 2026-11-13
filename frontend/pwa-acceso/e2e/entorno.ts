import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Valores compartidos por playwright.config.ts, el global setup y los tests.
 *
 * Los puertos son distintos a los de desarrollo (8000 y 5173) para poder correr las
 * pruebas con el entorno de desarrollo encendido sin pisarlo.
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
export const CARPETA_FRONTEND = path.resolve(aqui, '..');
export const CARPETA_BACKEND = path.resolve(CARPETA_FRONTEND, '../../backend');

export const PUERTO_BACKEND = Number(process.env.E2E_PUERTO_BACKEND ?? 8001);
export const PUERTO_FRONTEND = Number(process.env.E2E_PUERTO_FRONTEND ?? 4173);
export const PUERTO_SERVICIOS_FALSOS = Number(
  process.env.E2E_PUERTO_SERVICIOS_FALSOS ?? 8090
);

export const URL_BACKEND = `http://localhost:${PUERTO_BACKEND}`;
export const URL_FRONTEND = `http://localhost:${PUERTO_FRONTEND}`;
export const URL_SERVICIOS_FALSOS = `http://localhost:${PUERTO_SERVICIOS_FALSOS}`;

/**
 * Credenciales y clave del webhook generadas al azar en cada corrida: no hay secretos en el repo.
 * Playwright evalúa este archivo en el proceso principal y en cada worker; como los workers
 * heredan las variables de entorno del principal, con "??=" todos ven los mismos valores.
 */
function aleatorio(variable: string): string {
  const valor = process.env[variable] ?? randomBytes(16).toString('hex');
  process.env[variable] = valor;
  return valor;
}

export const CREDENCIALES = {
  admin: {
    email: 'admin-e2e@example.com',
    password: aleatorio('E2E_ADMIN_PASSWORD'),
  },
  guardia: {
    email: 'guardia-e2e@example.com',
    password: aleatorio('E2E_GUARDIA_PASSWORD'),
  },
} as const;

export const SECRETO_WEBHOOK_MP = aleatorio('E2E_SECRETO_WEBHOOK_MP');

/**
 * La base de pruebas sale del .env del backend: mismo usuario y servidor, con "_e2e" al final
 * del nombre. Así no hace falta configurar nada extra y nunca se usa la base de desarrollo.
 */
function baseDeDatosE2E(): { url: string; nombre: string } {
  const archivo = path.join(CARPETA_BACKEND, '.env');
  if (!existsSync(archivo)) {
    throw new Error(
      `No existe ${archivo}. Copiá backend/.env.example a backend/.env antes de correr las pruebas E2E.`
    );
  }
  const env = parseEnv(readFileSync(archivo, 'utf-8'));
  const {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB,
    POSTGRES_PORT = '5432',
  } = env;
  if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error(
      'backend/.env tiene que definir POSTGRES_USER, POSTGRES_PASSWORD y POSTGRES_DB.'
    );
  }
  const nombre = `${POSTGRES_DB}_e2e`;
  const usuario = encodeURIComponent(POSTGRES_USER);
  const clave = encodeURIComponent(POSTGRES_PASSWORD);
  return {
    nombre,
    url: `postgresql://${usuario}:${clave}@127.0.0.1:${POSTGRES_PORT}/${nombre}`,
  };
}

/** Variables con las que arranca el backend de pruebas. Pisan a las del backend/.env. */
export function entornoBackend(): Record<string, string> {
  const base = baseDeDatosE2E();
  return {
    // Sin esto "pipenv run" carga backend/.env pisando estas variables (y apuntaría a la base de desarrollo).
    // El backend igual lee su .env, pero con estas variables por encima
    PIPENV_DONT_LOAD_ENV: '1',
    ENVIRONMENT: 'development',
    DATABASE_URL: base.url,
    // Alembic usa DATABASE_URL; POSTGRES_DB queda por si se arma la conexión con POSTGRES_*
    POSTGRES_DB: base.nombre,
    FRONTEND_URL: URL_FRONTEND,
    BACKEND_PUBLIC_URL: URL_BACKEND,
    // Mercado Pago y Resend apuntan a los servicios falsos: nada sale a internet
    MERCADOPAGO_API_URL: URL_SERVICIOS_FALSOS,
    MERCADOPAGO_WEBHOOK_SECRET: SECRETO_WEBHOOK_MP,
    RESEND_API_URL: URL_SERVICIOS_FALSOS,
    E2E_ADMIN_EMAIL: CREDENCIALES.admin.email,
    E2E_ADMIN_PASSWORD: CREDENCIALES.admin.password,
    E2E_GUARDIA_EMAIL: CREDENCIALES.guardia.email,
    E2E_GUARDIA_PASSWORD: CREDENCIALES.guardia.password,
  };
}
