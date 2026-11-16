// @vitest-environment jsdom

// Dexie (useLiveQuery) solo emite si existe indexedDB, como en el navegador
import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import { dbService } from '@/services/dbService';
import { LayoutAcceso } from './LayoutAcceso';

vi.mock('@/services/dbService', () => ({
  dbService: { contarIngresosPendientes: vi.fn() },
}));

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'g-1', rol: 'SEGURIDAD', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function mostrar(ruta = '/acceso') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AuthProvider>
        <Routes>
          <Route element={<LayoutAcceso />}>
            <Route path="/acceso" element={<p>Pantalla del escáner</p>} />
            <Route path="/acceso/manual" element={<p>Pantalla del registro manual</p>} />
            <Route path="/acceso/historial" element={<p>Pantalla del historial</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

function simularConexion(enLinea: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => enLinea });
}

describe('Marco de la app del guardia (24.5 y 26.1)', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    simularConexion(true);
    vi.mocked(dbService.contarIngresosPendientes).mockResolvedValue(0);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    simularConexion(true);
  });

  it('muestra "Online" y cambia a "Offline" cuando se corta la conexión (26.1)', async () => {
    mostrar();
    const badge = screen.getByText('Online');
    expect(badge.getAttribute('role')).toBe('status');
    // El ícono acompaña al texto, pero el lector de pantalla solo lee el texto
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await screen.findByText('Todo sincronizado');

    simularConexion(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Es el mismo nodo: la región ya estaba en el DOM y solo cambió su texto, que es lo que se anuncia
    expect(badge.textContent).toBe('Offline');
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('muestra "N ingresos pendientes" en una región role="status" propia (26.1)', async () => {
    vi.mocked(dbService.contarIngresosPendientes).mockResolvedValue(3);
    mostrar();

    const contador = await screen.findByText('3 ingresos pendientes');
    expect(contador.getAttribute('role')).toBe('status');
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('avisa "Sincronizando…" mientras syncService envía el lote (26.1)', async () => {
    vi.mocked(dbService.contarIngresosPendientes).mockResolvedValue(1);
    mostrar();
    await screen.findByText('1 ingreso pendiente');

    act(() => {
      window.dispatchEvent(new CustomEvent('sync-status', { detail: { estado: 'iniciando', detalles: { cantidad: 1 } } }));
    });

    expect(screen.getByText('Sincronizando 1 ingreso pendiente…')).toBeTruthy();
  });

  it('la barra inferior marca la pantalla actual y lleva al registro manual', () => {
    mostrar();
    const escaner = screen.getByRole('link', { name: 'Escáner' });
    expect(escaner.getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('link', { name: 'Registro manual' }));

    expect(screen.getByText('Pantalla del registro manual')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Registro manual' }).getAttribute('aria-current')).toBe('page');
  });

  it('la barra inferior tiene Historial, Escáner y Registro manual, y lleva al historial', () => {
    mostrar();
    const nav = screen.getByRole('navigation', { name: 'Navegación de la app del guardia' });
    const textos = Array.from(nav.querySelectorAll('a')).map((enlace) => enlace.textContent);
    expect(textos).toEqual(['Historial', 'Escáner', 'Registro manual']);

    fireEvent.click(screen.getByRole('link', { name: 'Historial' }));

    expect(screen.getByText('Pantalla del historial')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Historial' }).getAttribute('aria-current')).toBe('page');
  });

  it('el menú muestra el estado de sincronización y permite cerrar sesión', async () => {
    vi.mocked(dbService.contarIngresosPendientes).mockResolvedValue(2);
    mostrar();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));

    // El texto aparece en la barra superior y en el menú
    expect(await screen.findAllByText('2 ingresos pendientes')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('sin pendientes, el menú dice "Todo sincronizado"', async () => {
    mostrar();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));

    expect(await screen.findAllByText('Todo sincronizado')).toHaveLength(2);
  });
});
