// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_KEY } from '@/context/AuthContext';
import App from '../App';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se reemplaza por un texto.
vi.mock('../pages/ControlAcceso', () => ({ default: () => 'Pantalla de control de acceso' }));

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken(rol: string, exp = Math.floor(Date.now() / 1000) + 3600) {
  const payload = base64Url({ sub: 'u-1', rol, exp });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

const SOCIO = {
  id: 'u-1',
  nombre: 'Ana Pérez',
  email: 'ana@correo.com',
  dni: '41234567',
  rol: 'CLIENTE',
  is_socio: true,
  membresia_vigente: true,
  membresia_vence: '2030-12-31',
};
const NO_SOCIO = { ...SOCIO, is_socio: false, membresia_vigente: false, membresia_vence: null };

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

// Simula el backend: /auth/me devuelve al usuario y /reservas/mias una lista vacía
function simularBackend(usuario: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/me')) return respuesta(200, usuario);
      return respuesta(200, []);
    })
  );
}

function abrir(ruta: string, rol?: string) {
  if (rol) localStorage.setItem(TOKEN_KEY, crearToken(rol));
  window.history.pushState({}, '', ruta);
  return render(<App />);
}

const formularioLogin = () => screen.queryByLabelText(/dni o email/i);
const pantallaAcceso = () => screen.queryByText('Pantalla de control de acceso');
const tituloPerfil = () => screen.queryByRole('heading', { level: 1, name: /mi perfil/i });
const avisoSoloSocios = () => screen.findByRole('heading', { name: /solo para socios/i });
const accesoDenegado = () => screen.queryByRole('heading', { level: 1, name: /acceso denegado/i });

function simularConexion(conectado: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: conectado });
}

describe('Rutas protegidas por rol', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    simularConexion(true);
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it.each(['/acceso', '/acceso/manual', '/acceso/historial', '/acceso/sincronizacion', '/perfil', '/mis-reservas'])('sin sesión, %s redirige al login', (ruta) => {
    abrir(ruta);

    expect(formularioLogin()).toBeTruthy();
  });

  // ---------- Las cuatro pantallas de la app del guardia (26.4) ----------
  const PANTALLAS_GUARDIA: Array<[string, () => HTMLElement | null]> = [
    ['/acceso', pantallaAcceso],
    ['/acceso/manual', () => screen.queryByRole('heading', { level: 1, name: 'Registro manual' })],
    ['/acceso/historial', () => screen.queryByRole('heading', { level: 1, name: 'Historial' })],
    ['/acceso/sincronizacion', () => screen.queryByRole('heading', { level: 1, name: 'Estado de sincronización' })],
  ];

  it.each(PANTALLAS_GUARDIA)('el guardia entra a %s, dentro del marco con la barra inferior', (ruta, pantalla) => {
    abrir(ruta, 'SEGURIDAD');

    expect(pantalla()).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegación de la app del guardia' })).toBeTruthy();
  });

  it.each(
    PANTALLAS_GUARDIA.flatMap(([ruta]) => [
      [ruta, 'ADMIN'],
      [ruta, 'CLIENTE'],
    ])
  )('%s no es para el rol %s: ve acceso denegado', (ruta, rol) => {
    abrir(ruta, rol);

    expect(accesoDenegado()).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Navegación de la app del guardia' })).toBeNull();
  });

  it.each(PANTALLAS_GUARDIA)('sin conexión y con el token vencido, el guardia sigue entrando a %s', (ruta, pantalla) => {
    simularConexion(false);
    localStorage.setItem(TOKEN_KEY, crearToken('SEGURIDAD', AYER()));

    abrir(ruta);

    expect(pantalla()).toBeTruthy();
    expect(formularioLogin()).toBeNull();
  });

  // WCAG 2.4.2 (27.1). App monta TituloDePagina: si se pierde al mergear, este test lo avisa
  it.each([
    ['/acceso', 'SEGURIDAD', 'Escáner | Qamp Acceso'],
    ['/acceso/manual', 'SEGURIDAD', 'Registro manual | Qamp Acceso'],
    ['/acceso/sincronizacion', 'SEGURIDAD', 'Estado de sincronización | Qamp Acceso'],
    ['/admin/socios', 'ADMIN', 'Socios | Qamp Panel'],
  ])('App pone el título de la pestaña en %s', async (ruta, rol, titulo) => {
    simularBackend(SOCIO);
    abrir(ruta, rol);

    await waitFor(() => expect(document.title).toBe(titulo));
  });

  it('el guardia entra a /acceso', () => {
    abrir('/acceso', 'SEGURIDAD');

    expect(pantallaAcceso()).toBeTruthy();
  });

  it('/acceso no muestra el encabezado ni el pie de la web de reservas', () => {
    abrir('/acceso', 'SEGURIDAD');

    expect(pantallaAcceso()).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^beneficios$/i })).toBeNull();
    // "Cerrar sesión" está en la barra inferior de la app del guardia (26.4)
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
  });

  it.each(['CLIENTE', 'ADMIN'])('el rol %s no entra a /acceso y ve acceso denegado', (rol) => {
    abrir('/acceso', rol);

    expect(pantallaAcceso()).toBeNull();
    expect(formularioLogin()).toBeNull();
    expect(accesoDenegado()).toBeTruthy();
  });

  it('sin sesión, /admin redirige al login', () => {
    abrir('/admin');

    expect(formularioLogin()).toBeTruthy();
  });

  it.each(['CLIENTE', 'SEGURIDAD'])('el rol %s no entra a /admin y ve acceso denegado', (rol) => {
    abrir('/admin/socios', rol);

    expect(accesoDenegado()).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: /navegación del panel de administración/i })).toBeNull();
  });

  it('el administrador entra a /admin', () => {
    abrir('/admin', 'ADMIN');

    expect(screen.getByRole('navigation', { name: /navegación del panel de administración/i })).toBeTruthy();
    expect(accesoDenegado()).toBeNull();
  });

  it('el acceso denegado ofrece volver a la pantalla del propio rol', () => {
    abrir('/acceso', 'ADMIN');

    expect(screen.getByRole('link', { name: /ir a mi pantalla/i }).getAttribute('href')).toBe('/admin');
  });

  // Token del guardia vencido (Issue 13.5)
  const AYER = () => Math.floor(Date.now() / 1000) - 86400;

  it('con conexión, un token vencido del guardia se descarta y pide iniciar sesión', () => {
    localStorage.setItem(TOKEN_KEY, crearToken('SEGURIDAD', AYER()));

    abrir('/acceso');

    expect(formularioLogin()).toBeTruthy();
    expect(pantallaAcceso()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('sin conexión, el guardia con el token vencido sigue en /acceso', () => {
    simularConexion(false);
    localStorage.setItem(TOKEN_KEY, crearToken('SEGURIDAD', AYER()));

    abrir('/acceso');

    expect(pantallaAcceso()).toBeTruthy();
    expect(formularioLogin()).toBeNull();
  });

  it.each(['ADMIN', 'CLIENTE'])('sin conexión, un token vencido del rol %s no se conserva', (rol) => {
    simularConexion(false);
    localStorage.setItem(TOKEN_KEY, crearToken(rol, AYER()));

    abrir('/login');

    expect(formularioLogin()).toBeTruthy();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('el socio entra a /perfil y ve sus datos reales', async () => {
    simularBackend(SOCIO);

    abrir('/perfil', 'CLIENTE');

    expect(await screen.findByRole('heading', { level: 1, name: /mi perfil/i })).toBeTruthy();
    expect(screen.getByText('Ana Pérez')).toBeTruthy();
  });

  it('el socio entra a /mis-reservas', async () => {
    simularBackend(SOCIO);

    abrir('/mis-reservas', 'CLIENTE');

    expect(await screen.findByRole('heading', { level: 1, name: /mis reservas/i })).toBeTruthy();
  });

  it.each(['/perfil', '/mis-reservas'])('un cliente que no es socio no entra a %s', async (ruta) => {
    simularBackend(NO_SOCIO);

    abrir(ruta, 'CLIENTE');

    expect(await avisoSoloSocios()).toBeTruthy();
    expect(tituloPerfil()).toBeNull();
  });

  it.each(['SEGURIDAD', 'ADMIN'])('el rol %s no entra a /perfil y ve acceso denegado', (rol) => {
    abrir('/perfil', rol);

    expect(tituloPerfil()).toBeNull();
    expect(accesoDenegado()).toBeTruthy();
  });
});