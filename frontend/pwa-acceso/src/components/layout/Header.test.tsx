// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import { Header } from './Header';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken(rol: string) {
  const payload = base64Url({ sub: 'u-1', rol, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function mostrar(rol?: string) {
  if (rol) localStorage.setItem(TOKEN_KEY, crearToken(rol));
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Header />
        <Routes>
          <Route path="*" element={<p>Contenido</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

async function abrirMenu() {
  // El menú de Radix se abre con el teclado; en jsdom es lo más estable
  fireEvent.keyDown(screen.getByRole('button', { name: /mi cuenta/i }), { key: 'Enter' });
  await screen.findByRole('menu');
}

const TODAS = ['Mi Perfil', 'Mis Reservas', 'Control de acceso', 'Panel de administración'];

describe('Menú del encabezado por rol (Issue 15.2)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Radix mide el menú con ResizeObserver, que jsdom no trae
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('el visitante ve "Iniciar Sesión" y no hay botón de pruebas', () => {
    mostrar();

    expect(screen.getByRole('link', { name: /iniciar sesión/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /mi cuenta/i })).toBeNull();
    expect(screen.queryByText('SW')).toBeNull();
  });

  it.each([
    ['CLIENTE', ['Mi Perfil', 'Mis Reservas']],
    ['SEGURIDAD', ['Control de acceso']],
    ['ADMIN', ['Panel de administración']],
  ])('el rol %s ve solo sus opciones', async (rol, esperadas) => {
    mostrar(rol);
    expect(screen.queryByRole('link', { name: /iniciar sesión/i })).toBeNull();

    await abrirMenu();

    for (const texto of TODAS) {
      const opcion = screen.queryByRole('menuitem', { name: texto });
      if (esperadas.includes(texto)) expect(opcion).toBeTruthy();
      else expect(opcion).toBeNull();
    }
    expect(screen.getByRole('menuitem', { name: /cerrar sesión/i })).toBeTruthy();
  });

  it('cerrar sesión elimina el token y vuelve a mostrar "Iniciar Sesión"', async () => {
    mostrar('CLIENTE');
    await abrirMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: /cerrar sesión/i }));

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await screen.findByRole('link', { name: /iniciar sesión/i })).toBeTruthy();
  });
});