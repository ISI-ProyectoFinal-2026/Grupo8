// @vitest-environment jsdom

// Dexie (useLiveQuery) solo emite si existe indexedDB, como en el navegador
import 'fake-indexeddb/auto';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/context/AuthContext';
import { db } from '@/db/db';
import { dbService } from '@/services/dbService';
import {
  CLAVE_ULTIMA_SINCRONIZACION,
  MENSAJE_SESION,
  syncService,
} from '@/services/syncService';
import EstadoSincronizacion from './EstadoSincronizacion';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`
function crearToken(exp = Math.floor(Date.now() / 1000) + 3600) {
  const payload = base64Url({ sub: 'g-1', rol: 'SEGURIDAD', exp });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function simularConexion(enLinea: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => enLinea,
  });
}

function mostrar() {
  return render(
    <MemoryRouter initialEntries={['/acceso/sincronizacion']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/acceso/sincronizacion"
            element={<EstadoSincronizacion />}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

const boton = () =>
  screen.getByRole('button', { name: /sincronizar ahora|sincronizando/i });

describe('Estado de sincronización (26.3)', () => {
  beforeEach(async () => {
    simularConexion(true);
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.configuracion.clear();
    // La sesión del guardia vive en IndexedDB (28.2)
    await dbService.guardarSesion(crearToken(), 'SEGURIDAD');
    syncService.isSyncing = false;
  });

  afterEach(async () => {
    cleanup();
    simularConexion(true);
    localStorage.clear();
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.configuracion.clear();
  });

  it('muestra conexión, última sincronización y pendientes', async () => {
    await dbService.registrarIngresoManual('30111222', 'Ana', 1, 'Espontaneo');
    await dbService.guardarConfiguracion(
      CLAVE_ULTIMA_SINCRONIZACION,
      '2026-11-16T05:30:15.000Z'
    );
    mostrar();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Estado de sincronización',
      })
    ).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    const hora = await screen.findByText((_, el) => el?.tagName === 'TIME');
    expect(hora.getAttribute('datetime')).toBe('2026-11-16T05:30:15.000Z');
    await waitFor(() =>
      expect(
        screen.getByText('Ingresos pendientes').nextElementSibling?.textContent
      ).toBe('1')
    );
  });

  it('sin sincronizaciones previas lo dice', async () => {
    mostrar();
    expect(
      await screen.findByText('Todavía no hubo una en este dispositivo')
    ).toBeTruthy();
  });

  it('sin conexión el botón queda deshabilitado y el motivo está a la vista y asociado al botón', async () => {
    await dbService.registrarIngresoManual('30111222', 'Ana', 0, 'Espontaneo');
    simularConexion(false);
    const sincronizar = vi.spyOn(syncService, 'sincronizarIngresosPendientes');
    mostrar();

    const motivo = await screen.findByText(
      /Sin conexión\. Los ingresos se van a enviar solos/
    );
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(boton().getAttribute('aria-disabled')).toBe('true');
    expect(boton().getAttribute('aria-describedby')).toBe(motivo.id);

    fireEvent.click(boton());
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it('si se corta la red con la pantalla abierta, el botón se deshabilita', async () => {
    await dbService.registrarIngresoManual('30111222', 'Ana', 0, 'Espontaneo');
    mostrar();
    await waitFor(() =>
      expect(boton().getAttribute('aria-disabled')).toBe('false')
    );

    simularConexion(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(boton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Sin conexión\./)).toBeTruthy();
  });

  it('sin pendientes no hay nada que enviar y lo explica', async () => {
    mostrar();
    expect(
      await screen.findByText('No hay ingresos pendientes para enviar.')
    ).toBeTruthy();
    expect(boton().getAttribute('aria-disabled')).toBe('true');
  });

  it('"Sincronizar ahora" llama al servicio, muestra el progreso y actualiza la pantalla al terminar', async () => {
    await dbService.registrarIngresoManual('30111222', 'Ana', 0, 'Espontaneo');
    let responder: (valor: unknown) => void = () => {};
    globalThis.fetch = vi
      .fn()
      .mockImplementation(async (_url: string, opciones: RequestInit) => {
        const { ingresos } = JSON.parse(opciones.body as string) as {
          ingresos: Array<{ jti: string }>;
        };
        await new Promise((resolver) => (responder = resolver));
        return {
          ok: true,
          json: async () => ({
            sincronizados_jti: ingresos.map((i) => i.jti),
            errores: [],
          }),
        };
      }) as unknown as typeof fetch;
    const sincronizar = vi.spyOn(syncService, 'sincronizarIngresosPendientes');
    mostrar();
    await waitFor(() =>
      expect(boton().getAttribute('aria-disabled')).toBe('false')
    );

    fireEvent.click(boton());

    expect(sincronizar).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('button', { name: 'Sincronizando…' })
    ).toBeTruthy();

    // Se responde recién cuando el pedido llegó a la red
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {
      responder(null);
    });

    expect(
      await screen.findByText('Listo: se enviaron 1 ingreso.')
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Listo');
    await waitFor(() =>
      expect(
        screen.getByText('Ingresos pendientes').nextElementSibling?.textContent
      ).toBe('0')
    );
    const hora = await screen.findByText((_, el) => el?.tagName === 'TIME');
    const guardada = await dbService.obtenerConfiguracion(
      CLAVE_ULTIMA_SINCRONIZACION
    );
    expect(hora.getAttribute('datetime')).toBe(guardada);
    expect(
      screen.getByRole('button', { name: 'Sincronizar ahora' })
    ).toBeTruthy();
  });

  it('muestra el error que avisa syncService (por ejemplo, sin permiso)', async () => {
    await dbService.registrarIngresoManual('30111222', 'Ana', 0, 'Espontaneo');
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;
    mostrar();
    await waitFor(() =>
      expect(boton().getAttribute('aria-disabled')).toBe('false')
    );

    fireEvent.click(boton());

    expect(
      await screen.findByText(
        'Tu usuario no tiene permiso para sincronizar ingresos.'
      )
    ).toBeTruthy();
  });

  it('con el token vencido muestra el aviso de syncService y ofrece iniciar sesión de nuevo', async () => {
    await dbService.guardarSesion(
      crearToken(Math.floor(Date.now() / 1000) - 60),
      'SEGURIDAD'
    );
    // Sin red, la app le conserva la sesión vencida al guardia
    simularConexion(false);
    mostrar();

    expect((await screen.findByRole('alert')).textContent).toContain(
      MENSAJE_SESION
    );
    expect(
      screen.queryByRole('button', { name: /sincronizar ahora/i })
    ).toBeNull();
    const iniciar = screen.getByRole('button', {
      name: 'Iniciar sesión de nuevo',
    });
    // Sin red no se puede iniciar sesión: el botón no hace nada y dice por qué
    expect(iniciar.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText(/Sin conexión no se puede iniciar sesión/)
    ).toBeTruthy();

    simularConexion(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(iniciar.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(iniciar);

    // Se cierra la sesión: se borra de IndexedDB y la ruta protegida lo lleva al login
    await waitFor(async () => expect(await dbService.obtenerSesion()).toBeNull());
  });
});
