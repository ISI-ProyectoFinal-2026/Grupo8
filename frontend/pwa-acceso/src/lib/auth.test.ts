// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT } from '@/context/AuthContext';
import { ErrorPerfil, obtenerUsuarioActual } from './auth';

const USUARIO = {
  id: 'u-1',
  nombre: 'Ana Pérez',
  email: 'ana@correo.com',
  dni: '41234567',
  rol: 'CLIENTE',
  is_socio: true,
  membresia_vigente: true,
  membresia_vence: '2030-12-31',
};

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

describe('obtenerUsuarioActual (GET /auth/me)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda el token y devuelve los datos del usuario', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(200, USUARIO));
    vi.stubGlobal('fetch', fetchFalso);

    const usuario = await obtenerUsuarioActual('token-123');

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(String(url).endsWith('/auth/me')).toBe(true);
    expect(opciones.headers.Authorization).toBe('Bearer token-123');
    expect(usuario).toEqual(USUARIO);
  });

  it('con 401 avisa a la app para que cierre la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(401, { detail: 'No autorizado' })));
    const aviso = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, aviso);

    await expect(obtenerUsuarioActual('vencido')).rejects.toBeInstanceOf(ErrorPerfil);

    window.removeEventListener(AUTH_EXPIRED_EVENT, aviso);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it('con otro error del servidor lanza ErrorPerfil con su estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(500, {})));

    await expect(obtenerUsuarioActual('token')).rejects.toMatchObject({ status: 500 });
  });
});