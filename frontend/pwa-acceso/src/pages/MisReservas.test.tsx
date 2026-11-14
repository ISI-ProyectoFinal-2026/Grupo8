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

function respuestaPng(status: number) {
  return {
    ok: status < 400,
    status,
    json: async () => ({}),
    blob: async () => new Blob(['png'], { type: 'image/png' }),
  } as unknown as Response;
}

// jsdom no implementa URL.createObjectURL ni URL.revokeObjectURL
const urlOriginal = { crear: URL.createObjectURL, liberar: URL.revokeObjectURL };

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
    vi.restoreAllMocks();
    URL.createObjectURL = urlOriginal.crear;
    URL.revokeObjectURL = urlOriginal.liberar;
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
  it('en las próximas, "Descargar QR" descarga el QR de la reserva con el token', async () => {
    const token = crearToken();
    localStorage.setItem(TOKEN_KEY, token);
    const fetchFalso = vi.fn(async (url: string) =>
      url.endsWith('/qr') ? respuestaPng(200) : respuesta(200, [PROXIMA])
    );
    vi.stubGlobal('fetch', fetchFalso);
    const crearUrl = vi.fn(() => 'blob:qr-falso');
    const liberarUrl = vi.fn();
    URL.createObjectURL = crearUrl;
    URL.revokeObjectURL = liberarUrl;
    const descargas: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      descargas.push({ href: this.href, download: this.download });
    });

    mostrar();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /próximas/i }), { button: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /descargar qr/i }));

    await waitFor(() => expect(descargas).toHaveLength(1));
    const [url, opciones] = fetchFalso.mock.calls[1] as unknown as [string, RequestInit];
    expect(url.endsWith(`/reservas/${PROXIMA.id}/qr`)).toBe(true);
    expect((opciones.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
    expect(crearUrl).toHaveBeenCalledTimes(1);
    expect(descargas[0]).toEqual({ href: 'blob:qr-falso', download: `QR_Acceso_${PROXIMA.id}.png` });
    await waitFor(() => expect(liberarUrl).toHaveBeenCalledWith('blob:qr-falso'));
  });

  it('"Cancelar" en una próxima abre el diálogo y al confirmar pasa a Canceladas sin recargar', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/cancelacion')) {
        return respuesta(200, {
          puede_cancelar: true,
          dias_minimos: 1,
          fecha_limite: '2099-01-09',
          porcentaje_devolucion: 100,
          monto_devolucion: 7777,
          mensaje: null,
        });
      }
      if (init?.method === 'POST') {
        return respuesta(200, {
          id: PROXIMA.id,
          estado_reserva: 'Cancelada',
          estado_pago: 'Pagado',
          monto_devuelto: 7777,
          devolucion_realizada: true,
          mensaje: 'La reserva quedó cancelada. Te devolvimos $ 7.777,00 por Mercado Pago.',
        });
      }
      return respuesta(200, [PROXIMA]);
    });
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /próximas/i }), { button: 0 });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cancelación' }));

    // Se cierra el diálogo y se muestra el resultado
    expect(
      await screen.findByText('La reserva quedó cancelada. Te devolvimos $ 7.777,00 por Mercado Pago.')
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Ya no está en Próximas: está en Canceladas
    expect(screen.queryByText(/\$7\.777/)).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /canceladas/i }), { button: 0 });
    await waitFor(() => expect(screen.getByText(/\$7\.777/)).toBeTruthy());
    // La lista no se volvió a pedir al backend
    const pedidosDeLista = fetchFalso.mock.calls.filter(([url]) => String(url).endsWith('/reservas/mias'));
    expect(pedidosDeLista).toHaveLength(1);
  });

  it('"Volver" cierra el diálogo y la reserva sigue en Próximas', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/cancelacion')
          ? respuesta(200, {
              puede_cancelar: false,
              dias_minimos: 1,
              fecha_limite: '2099-01-09',
              porcentaje_devolucion: 100,
              monto_devolucion: 7777,
              mensaje: 'Lo sentimos, las reservas solo se pueden cancelar hasta 1 día antes del ingreso.',
            })
          : respuesta(200, [PROXIMA])
      )
    );

    mostrar();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /próximas/i }), { button: 0 });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await screen.findByText('Lo sentimos, las reservas solo se pueden cancelar hasta 1 día antes del ingreso.');
    expect(screen.queryByRole('button', { name: 'Confirmar cancelación' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/\$7\.777/)).toBeTruthy();
  });

  it('las reservas pendientes, finalizadas y canceladas no tienen "Cancelar"', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(200, [PENDIENTE, FINALIZADA, CANCELADA])));

    mostrar();

    await screen.findByText(/\$18\.450/);
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    for (const [pestana, monto] of [[/finalizadas/i, /\$3\.333/], [/canceladas/i, /\$1\.111/]] as const) {
      fireEvent.mouseDown(screen.getByRole('tab', { name: pestana }), { button: 0 });
      await waitFor(() => expect(screen.getByText(monto)).toBeTruthy());
      expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    }
  });

  it('si la descarga del QR falla, avisa y no descarga nada', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.endsWith('/qr') ? respuestaPng(403) : respuesta(200, [PROXIMA])))
    );
    const crearUrl = vi.fn(() => 'blob:qr-falso');
    URL.createObjectURL = crearUrl;

    mostrar();
    fireEvent.mouseDown(await screen.findByRole('tab', { name: /próximas/i }), { button: 0 });
    fireEvent.click(await screen.findByRole('button', { name: /descargar qr/i }));

    await waitFor(() =>
      expect(screen.getByText(/el qr solo está disponible para reservas pagadas/i)).toBeTruthy()
    );
    expect(crearUrl).not.toHaveBeenCalled();
  });
});
