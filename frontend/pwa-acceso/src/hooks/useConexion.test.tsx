// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { dbService } from '@/services/dbService';
import { useConexion } from './useConexion';

function simularConexion(enLinea: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => enLinea,
  });
}

function emitirSync(estado: string) {
  window.dispatchEvent(
    new CustomEvent('sync-status', { detail: { estado, detalles: {} } })
  );
}

describe('useConexion (26.1)', () => {
  beforeEach(async () => {
    simularConexion(true);
    await db.ingresos_pendientes.clear();
  });

  afterEach(async () => {
    simularConexion(true);
    await db.ingresos_pendientes.clear();
  });

  it('arranca con el valor de navigator.onLine y sigue los eventos online/offline', () => {
    simularConexion(false);
    const { result } = renderHook(() => useConexion());
    expect(result.current.enLinea).toBe(false);

    simularConexion(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.enLinea).toBe(true);

    simularConexion(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.enLinea).toBe(false);
  });

  it('el contador sube al registrar un ingreso y baja cuando el servidor lo confirma', async () => {
    const { result } = renderHook(() => useConexion());
    await waitFor(() => expect(result.current.pendientes).toBe(0));

    // Nadie avisa al hook: Dexie detecta el cambio en la tabla
    await act(async () => {
      await dbService.registrarIngresoOffline('jti-1', {
        cantidad_personas: 2,
      });
      await dbService.registrarIngresoOffline('jti-2', {
        cantidad_personas: 1,
      });
    });
    await waitFor(() => expect(result.current.pendientes).toBe(2));

    // Lo mismo que hace syncService al terminar una sincronización
    await act(async () => {
      await dbService.marcarComoSincronizados(['jti-1']);
    });
    await waitFor(() => expect(result.current.pendientes).toBe(1));
  });

  it('marca "sincronizando" con los avisos de syncService', () => {
    const { result } = renderHook(() => useConexion());

    act(() => emitirSync('iniciando'));
    expect(result.current.sincronizando).toBe(true);

    act(() => emitirSync('completado'));
    expect(result.current.sincronizando).toBe(false);

    act(() => emitirSync('reintentando'));
    expect(result.current.sincronizando).toBe(true);

    // Si se corta la red, no puede seguir sincronizando
    simularConexion(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.sincronizando).toBe(false);
  });

  it('si IndexedDB falla, pendientes queda en null en vez de romper la pantalla', async () => {
    vi.spyOn(dbService, 'contarIngresosPendientes').mockRejectedValue(
      new Error('sin IndexedDB')
    );
    const { result } = renderHook(() => useConexion());
    await waitFor(() => expect(result.current.pendientes).toBeNull());
  });

  it('al desmontarse saca los tres listeners', () => {
    const quitar = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useConexion());

    unmount();

    const eventos = quitar.mock.calls.map(([nombre]) => nombre);
    expect(eventos).toEqual(
      expect.arrayContaining(['online', 'offline', 'sync-status'])
    );
  });
});
