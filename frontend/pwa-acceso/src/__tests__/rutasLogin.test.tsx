// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '@/context/AuthContext';
import { db } from '@/db/db';
import { dbService } from '@/services/dbService';
import App from '../App';
import manifestAdminTexto from '../../public/manifest-admin.webmanifest?raw';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte de este flujo
vi.mock('../pages/ControlAcceso', () => ({ default: () => 'Pantalla de control de acceso' }));

// El inicio del panel consulta la ocupación y los cobros: acá solo se prueba la navegación
vi.mock('@/services/ocupacionService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/ocupacionService')>();
  return { ...original, obtenerOcupacion: vi.fn(() => new Promise(() => {})) };
});
vi.mock('@/components/admin/ResumenCobros', () => ({ ResumenCobros: () => null }));

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken(rol: string) {
  const payload = base64Url({ sub: 'u-1', rol, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

// POST /auth/login devuelve un token con el rol pedido; el resto de los pedidos queda pendiente
function simularLogin(rol: string) {
  const token = crearToken(rol);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      String(url).endsWith('/auth/login')
        ? Promise.resolve(respuesta(200, { access_token: token }))
        : new Promise(() => {})
    )
  );
  return token;
}

// La sesión del guardia vive en IndexedDB (28.2); la de los demás roles, en localStorage
async function abrir(ruta: string, rolConSesion?: string) {
  if (rolConSesion === 'SEGURIDAD') await dbService.guardarSesion(crearToken(rolConSesion), rolConSesion);
  else if (rolConSesion) localStorage.setItem(TOKEN_KEY, crearToken(rolConSesion));
  window.history.pushState({}, '', ruta);
  return render(<App />);
}

async function ingresar() {
  // El login del guardia espera a leer IndexedDB antes de mostrarse
  await screen.findByLabelText(/dni o email/i);
  fireEvent.change(screen.getByLabelText(/dni o email/i), { target: { value: '41234567' } });
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'clave1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
}

const loginWeb = () => screen.queryByRole('heading', { level: 1, name: /^iniciar sesión$/i });
const loginPanel = () => screen.queryByRole('heading', { level: 1, name: /panel de administración/i });
const loginAcceso = () => screen.queryByRole('heading', { level: 1, name: /control de acceso/i });
const encabezadoWeb = () => screen.queryByRole('link', { name: /^beneficios$/i });
const accesoDenegado = () => screen.queryByRole('heading', { level: 1, name: /acceso denegado/i });
const manifestActual = () =>
  document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null;

describe('Inicio de sesión por app (Issue 23.1)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await db.configuracion.clear();
  });
  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    await db.configuracion.clear();
    window.history.pushState({}, '', '/');
  });

  describe('cada app tiene su propio login y su diseño', () => {
    it('/login es el de los socios, dentro de la web de reservas', async () => {
      await abrir('/login');

      expect(loginWeb()).toBeTruthy();
      expect(encabezadoWeb()).toBeTruthy();
      expect(loginPanel()).toBeNull();
      expect(loginAcceso()).toBeNull();
    });

    it('/admin/login es el del panel, sin el encabezado de la web', async () => {
      await abrir('/admin/login');

      expect(loginPanel()).toBeTruthy();
      expect(encabezadoWeb()).toBeNull();
      expect(loginWeb()).toBeNull();
    });

    it('/acceso/login es el del guardia, sin el encabezado de la web', async () => {
      await abrir('/acceso/login');

      await waitFor(() => expect(loginAcceso()).toBeTruthy());
      expect(encabezadoWeb()).toBeNull();
      expect(loginWeb()).toBeNull();
    });
  });

  describe('sin sesión, cada ruta protegida lleva al login de su app', () => {
    it('/mis-reservas lleva a /login', async () => {
      await abrir('/mis-reservas');

      expect(window.location.pathname).toBe('/login');
      expect(loginWeb()).toBeTruthy();
    });

    it('/admin/socios lleva a /admin/login', async () => {
      await abrir('/admin/socios');

      expect(window.location.pathname).toBe('/admin/login');
      expect(loginPanel()).toBeTruthy();
    });

    it('/acceso lleva a /acceso/login', async () => {
      await abrir('/acceso');

      await waitFor(() => expect(window.location.pathname).toBe('/acceso/login'));
      await waitFor(() => expect(loginAcceso()).toBeTruthy());
    });
  });

  it.each([
    ['/login', 'CLIENTE', '/mis-reservas'],
    ['/admin/login', 'ADMIN', '/admin'],
    ['/acceso/login', 'SEGURIDAD', '/acceso'],
  ])('en %s, un usuario %s entra y va a %s', async (ruta, rol, destino) => {
    const token = simularLogin(rol);

    await abrir(ruta);
    await ingresar();

    await waitFor(() => expect(window.location.pathname).toBe(destino));
    // El guardia guarda la sesión en IndexedDB; los demás roles, en localStorage
    if (rol === 'SEGURIDAD') {
      expect((await dbService.obtenerSesion())?.token).toBe(token);
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    } else {
      expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
    }
  });

  it.each([
    ['/login', 'ADMIN'],
    ['/login', 'SEGURIDAD'],
    ['/admin/login', 'CLIENTE'],
    ['/admin/login', 'SEGURIDAD'],
    ['/acceso/login', 'CLIENTE'],
    ['/acceso/login', 'ADMIN'],
  ])('en %s, un usuario %s recibe acceso denegado y no abre sesión', async (ruta, rol) => {
    simularLogin(rol);

    await abrir(ruta);
    await ingresar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/acceso denegado/i);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.location.pathname).toBe(ruta);
  });

  it.each([
    ['/login', 'ADMIN'],
    ['/admin/login', 'SEGURIDAD'],
    ['/acceso/login', 'CLIENTE'],
  ])('con sesión de otra app, %s muestra acceso denegado (rol %s)', async (ruta, rol) => {
    await abrir(ruta, rol);

    await waitFor(() => expect(accesoDenegado()).toBeTruthy());
    expect(screen.queryByLabelText(/dni o email/i)).toBeNull();
  });

  describe('manifest del panel', () => {
    it('el panel usa su propio manifest', async () => {
      await abrir('/admin/login');

      expect(manifestActual()).toBe('/manifest-admin.webmanifest');
    });

    it('la PWA del guardia no usa el manifest del panel', async () => {
      await abrir('/acceso/login');

      expect(manifestActual()).not.toBe('/manifest-admin.webmanifest');
    });

    it('el manifest se llama "Qamp Admin", abre en /admin/ y se muestra como app', () => {
      const manifest = JSON.parse(manifestAdminTexto);

      expect(manifest.name).toBe('Qamp Admin');
      expect(manifest.start_url).toBe('/admin/');
      expect(manifest.scope).toBe('/admin/');
      expect(manifest.display).toBe('standalone');
      const tamanios = manifest.icons.map((icono: { sizes: string }) => icono.sizes);
      expect(tamanios).toContain('192x192');
      expect(tamanios).toContain('512x512');
      expect(manifest.icons.every((icono: { src: string }) => icono.src.startsWith('/admin-'))).toBe(true);
    });
  });
});
