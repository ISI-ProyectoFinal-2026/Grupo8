// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT } from '@/context/AuthContext';
import {
  ErrorArrepentimiento,
  confirmarArrepentimiento,
  obtenerCondicionesPorEnlace,
  solicitarEnlaces,
} from './arrepentimiento';

function respuesta(status: number, cuerpo: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

describe('Llamadas del botón de arrepentimiento (25.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide los enlaces con el email, sin sesión', async () => {
    const fetchFalso = vi.fn(async () => respuesta(202, { mensaje: 'ok' }));
    vi.stubGlobal('fetch', fetchFalso);

    await solicitarEnlaces('  ana@correo.com ');

    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/arrepentimiento\/solicitud$/);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body as string)).toEqual({ email: 'ana@correo.com' });
    expect(new Headers(opciones.headers).has('Authorization')).toBe(false);
  });

  it('consulta las condiciones con el token en la URL', async () => {
    const fetchFalso = vi.fn(async () => respuesta(200, { puede_cancelar: true }));
    vi.stubGlobal('fetch', fetchFalso);

    await obtenerCondicionesPorEnlace('a.b+c/d');

    const [url] = fetchFalso.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/arrepentimiento\/condiciones\?token=a\.b%2Bc%2Fd$/);
  });

  it('confirma mandando solo el token', async () => {
    const fetchFalso = vi.fn(async () => respuesta(200, { codigo_gestion: 'r-1' }));
    vi.stubGlobal('fetch', fetchFalso);

    const resultado = await confirmarArrepentimiento('tok');

    const [, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(opciones.body as string)).toEqual({ token: 'tok' });
    expect(resultado.codigo_gestion).toBe('r-1');
  });

  it('con 401 devuelve el motivo del backend y no cierra ninguna sesión', async () => {
    const detail = 'El enlace venció. Pedí uno nuevo desde el botón de arrepentimiento.';
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(401, { detail })));
    const sesionVencida = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, sesionVencida);

    const error = await obtenerCondicionesPorEnlace('tok').catch((e) => e);

    window.removeEventListener(AUTH_EXPIRED_EVENT, sesionVencida);
    expect(error).toBeInstanceOf(ErrorArrepentimiento);
    expect((error as ErrorArrepentimiento).status).toBe(401);
    expect((error as ErrorArrepentimiento).message).toBe(detail);
    expect(sesionVencida).not.toHaveBeenCalled();
  });

  it('con 422 devuelve el motivo del backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(422, { detail: 'La reserva ya está cancelada.' }))
    );

    await expect(confirmarArrepentimiento('tok')).rejects.toMatchObject({
      status: 422,
      message: 'La reserva ya está cancelada.',
    });
  });

  it('con un error del servidor usa un mensaje genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(500, { detail: 'Traceback…' })));

    await expect(solicitarEnlaces('ana@correo.com')).rejects.toMatchObject({
      status: 500,
      message: 'No pudimos enviar el correo. Intentá nuevamente.',
    });
  });

  it('sin conexión avisa con status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(confirmarArrepentimiento('tok')).rejects.toMatchObject({
      status: 0,
      message: 'No se pudo conectar con el servidor. Intentá nuevamente.',
    });
  });
});
