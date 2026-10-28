// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { ReservaDetalle } from '@/lib/misReservas';
import MisReservas from './MisReservas';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'u-1', rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function reserva(cambios: Partial<ReservaDetalle>): ReservaDetalle {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    fecha_reserva: '2030-01-01T10:00:00',
    fecha_ingreso: '2099-01-10',
    fecha_egreso: '2099-01-12',
    cantidad_personas: 2,
    cantidad_socios: 1,
    monto_total: 18450,
    titular: 'Ana Pérez',
    estado_reserva: 'Pendiente',
    estado_pago: 'Pendiente',
    personas: [],
    ...cambios,
  };
}

const PENDIENTE = reserva({ id: 'pendiente-0000', estado_reserva: 'Pendiente', monto_total: 18450 });
const PROXIMA = reserva({ id: 'proxima-00000', estado_reserva: 'Confirmada', monto_total: 7777 });
const FINALIZADA = reserva({
  id: 'finaliza-0000',
  estado_reserva: 'Confirmada',
  fecha_ingreso: '2020-01-10',
  fecha_egreso: '2020-01-12',
  monto_total: 3333,
});
const CANCELADA = reserva({ id: 'cancelad-0000', estado_reserva: 'Cancelada', monto_total: 1111 });

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

function mostrar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <MisReservas />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Mis reservas', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sin sesión pide iniciar sesión y no llama a la API', () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();

    expect(screen.getByText(/iniciá sesión para ver tus reservas/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /iniciar sesión/i }).getAttribute('href')).toBe('/login');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('con sesión trae las reservas del backend con el token', async () => {
    const token = crearToken();
    localStorage.setItem(TOKEN_KEY, token);
    const fetchFalso = vi.fn(async () => respuesta(200, [PENDIENTE]));
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();

    await waitFor(() => expect(screen.getByText(/\$18\.450/)).toBeTruthy());
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/reservas/mias')).toBe(true);
    expect((opciones.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
  });

  it('no muestra reservas de ejemplo: lo que se ve es lo que devolvió el backend', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(200, [])));

    mostrar();

    await waitFor(() => expect(screen.getByText(/no hay reservas en esta categoría/i)).toBeTruthy());
    expect(screen.queryByText(/RES-001/)).toBeNull();
    expect(screen.queryByText(/\$25\.000/)).toBeNull();
  });

  it('muestra cada reserva en su pestaña según su estado', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(200, [PENDIENTE, PROXIMA, FINALIZADA, CANCELADA]))
    );

    mostrar();

    // Pestaña inicial: pendientes
    await waitFor(() => expect(screen.getByText(/\$18\.450/)).toBeTruthy());
    expect(screen.queryByText(/\$7\.777/)).toBeNull();

    // Radix abre la pestaña con mouseDown
    fireEvent.mouseDown(screen.getByRole('tab', { name: /próximas/i }), { button: 0 });
    await waitFor(() => expect(screen.getByText(/\$7\.777/)).toBeTruthy());

    fireEvent.mouseDown(screen.getByRole('tab', { name: /finalizadas/i }), { button: 0 });
    await waitFor(() => expect(screen.getByText(/\$3\.333/)).toBeTruthy());

    fireEvent.mouseDown(screen.getByRole('tab', { name: /canceladas/i }), { button: 0 });
    await waitFor(() => expect(screen.getByText(/\$1\.111/)).toBeTruthy());
  });

  it('muestra la cantidad de personas y de socios de la reserva', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(200, [PENDIENTE])));

    mostrar();

    await waitFor(() => expect(screen.getByText(/2 personas \(1 socio\)/)).toBeTruthy());
  });

  it('si falla la carga avisa y permite reintentar', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta(500, {}))
      .mockResolvedValueOnce(respuesta(200, [PENDIENTE]));
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();

    await waitFor(() => expect(screen.getByText(/no pudimos cargar tus reservas/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => expect(screen.getByText(/\$18\.450/)).toBeTruthy());
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('si el token venció cierra la sesión y vuelve a pedir que inicie sesión', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(401, {})));

    mostrar();

    await waitFor(() => expect(screen.getByText(/iniciá sesión para ver tus reservas/i)).toBeTruthy());
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
