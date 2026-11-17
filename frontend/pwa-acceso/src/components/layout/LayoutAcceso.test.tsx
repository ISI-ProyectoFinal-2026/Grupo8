// @vitest-environment jsdom

// Dexie (useLiveQuery) solo emite si existe indexedDB, como en el navegador
import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import { dbService } from '@/services/dbService';
import { syncService } from '@/services/syncService';
import { LayoutAcceso } from './LayoutAcceso';

vi.mock('@/services/dbService', () => ({
  dbService: { contarIngresosPendientes: vi.fn() },
}));
// La sincronización de fondo se prueba en syncService; acá interesa que el marco la arranque
vi.mock('@/services/syncService', () => ({
  syncService: { iniciarBackgroundSync: vi.fn() },
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
            <Route path="/acceso/sincronizacion" element={<p>Pantalla de sincronización</p>} />
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

  it('la barra inferior tiene las cinco opciones del documento, cada una con ícono y texto (26.4)', () => {
    mostrar();
    const nav = screen.getByRole('navigation', { name: 'Navegación de la app del guardia' });
    const opciones = within(nav).getAllByRole('listitem');

    expect(opciones.map((opcion) => opcion.textContent)).toEqual([
      'Historial',
      'Registro manual',
      'Escáner',
      'Sincronización',
      'Cerrar sesión',
    ]);
    for (const opcion of opciones) {
      expect(opcion.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    // Las cuatro pantallas son enlaces; cerrar sesión es una acción, así que es un botón
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
  });

  it.each([
    ['Registro manual', 'Pantalla del registro manual'],
    ['Historial', 'Pantalla del historial'],
    ['Sincronización', 'Pantalla de sincronización'],
    ['Escáner', 'Pantalla del escáner'],
  ])('al tocar "%s" abre su pantalla y solo esa opción queda con aria-current="page" (26.4)', (opcion, pantalla) => {
    mostrar(opcion === 'Escáner' ? '/acceso/historial' : '/acceso');

    fireEvent.click(screen.getByRole('link', { name: opcion }));

    expect(screen.getByText(pantalla)).toBeTruthy();
    expect(screen.getByRole('link', { name: opcion }).getAttribute('aria-current')).toBe('page');
    const marcadas = screen.getAllByRole('link').filter((enlace) => enlace.getAttribute('aria-current') === 'page');
    expect(marcadas).toHaveLength(1);
  });

  it('el título de la barra superior sigue a la pantalla actual', () => {
    mostrar('/acceso/sincronizacion');
    expect(screen.getByRole('banner').textContent).toContain('Sincronización');
  });

  it('"Cerrar sesión" está en la barra inferior y ya no hay menú en la barra superior (26.4)', () => {
    mostrar();
    expect(screen.queryByRole('button', { name: 'Abrir menú' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('arranca la sincronización de fondo, que ya no depende de estar en el escáner (26.4)', () => {
    mostrar('/acceso/historial');
    expect(syncService.iniciarBackgroundSync).toHaveBeenCalledTimes(1);
  });
});
