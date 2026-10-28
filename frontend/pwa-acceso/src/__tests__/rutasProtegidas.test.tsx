// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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
function crearToken(rol: string) {
  const payload = base64Url({ sub: 'u-1', rol, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function abrir(ruta: string, rol?: string) {
  if (rol) localStorage.setItem(TOKEN_KEY, crearToken(rol));
  window.history.pushState({}, '', ruta);
  return render(<App />);
}

const formularioLogin = () => screen.queryByLabelText(/dni o email/i);
const pantallaAcceso = () => screen.queryByText('Pantalla de control de acceso');
const tituloPerfil = () => screen.queryByRole('heading', { level: 1, name: /mi perfil/i });

describe('Rutas protegidas por rol', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it.each(['/acceso', '/perfil', '/mis-reservas'])('sin sesión, %s redirige al login', (ruta) => {
    abrir(ruta);

    expect(formularioLogin()).toBeTruthy();
  });

  it('el guardia entra a /acceso', () => {
    abrir('/acceso', 'SEGURIDAD');

    expect(pantallaAcceso()).toBeTruthy();
  });

  it('/acceso no muestra el encabezado ni el pie de la web de reservas', () => {
    abrir('/acceso', 'SEGURIDAD');

    expect(pantallaAcceso()).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^beneficios$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeTruthy();
  });

  it.each(['CLIENTE', 'ADMIN'])('el rol %s no entra a /acceso', (rol) => {
    abrir('/acceso', rol);

    expect(pantallaAcceso()).toBeNull();
    expect(formularioLogin()).toBeNull();
  });

  it('el socio entra a /perfil', () => {
    abrir('/perfil', 'CLIENTE');

    expect(tituloPerfil()).toBeTruthy();
  });

  it.each(['SEGURIDAD', 'ADMIN'])('el rol %s no entra a /perfil', (rol) => {
    abrir('/perfil', rol);

    expect(tituloPerfil()).toBeNull();
  });
});