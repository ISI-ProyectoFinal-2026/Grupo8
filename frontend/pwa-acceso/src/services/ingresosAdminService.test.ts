// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IngresosApiError,
  mensajeDeError,
  obtenerHistorialIngresos,
} from './ingresosAdminService';

describe('ingresosAdminService (26.6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide el rango y la página con el token del administrador', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        desde: '2026-11-10',
        hasta: '2026-11-17',
        total: 0,
        items: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await obtenerHistorialIngresos('token-admin', {
      desde: '2026-11-10',
      hasta: '2026-11-17',
      pagina: 2,
    });

    const [url, opciones] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parametros = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe('/api/v1/admin/ingresos');
    expect(Object.fromEntries(parametros)).toEqual({
      desde: '2026-11-10',
      hasta: '2026-11-17',
      skip: '40',
      limit: '20',
    });
    expect(opciones.headers).toEqual({ Authorization: 'Bearer token-admin' });
  });

  it('un error del backend trae su status y su mensaje', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          detail: 'El rango no puede superar los 92 días.',
        }),
      })
    );

    const error = await obtenerHistorialIngresos('t', {
      desde: '2026-01-01',
      hasta: '2026-12-31',
      pagina: 0,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(IngresosApiError);
    expect(error.status).toBe(422);
    expect(mensajeDeError(error)).toBe(
      'El rango no puede superar los 92 días.'
    );
  });

  it('traduce 401, 403 y la falta de conexión', () => {
    expect(mensajeDeError(new IngresosApiError(401, 'x'))).toBe(
      'Tu sesión venció. Volvé a iniciar sesión.'
    );
    expect(mensajeDeError(new IngresosApiError(403, 'x'))).toBe(
      'No tenés permisos para ver el historial de ingresos.'
    );
    expect(mensajeDeError(new TypeError('Failed to fetch'))).toBe(
      'No se pudo conectar con el servidor.'
    );
  });
});
