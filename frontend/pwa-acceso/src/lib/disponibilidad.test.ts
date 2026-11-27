import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '@/lib/descuentos';
import { obtenerDisponibilidad } from './disponibilidad';

const CUERPO = {
  cupo_maximo: 80,
  dias: [{ fecha: '2030-01-10', ocupados: 15, disponibles: 65, completo: false }],
  estadia: null,
};

function responder(status: number, cuerpo: unknown) {
  const fetchFalso = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => cuerpo,
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

describe('obtenerDisponibilidad (Issue 31.4)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pide los 7 días desde la fecha y devuelve lo que manda el backend', async () => {
    const fetchFalso = responder(200, CUERPO);

    const datos = await obtenerDisponibilidad('2030-01-10', null);

    const url = new URL(String(fetchFalso.mock.calls[0][0]));
    expect(url.pathname).toBe('/disponibilidad');
    expect(url.searchParams.get('desde')).toBe('2030-01-10');
    expect(url.searchParams.get('dias')).toBe('7');
    expect(url.searchParams.has('egreso')).toBe(false);
    expect(datos).toEqual(CUERPO);
  });

  it('envía el egreso cuando se indica', async () => {
    const fetchFalso = responder(200, CUERPO);

    await obtenerDisponibilidad('2030-01-10', '2030-01-13');

    const url = new URL(String(fetchFalso.mock.calls[0][0]));
    expect(url.searchParams.get('egreso')).toBe('2030-01-13');
  });

  it('un error del servidor se informa con el status', async () => {
    responder(500, {});

    await expect(obtenerDisponibilidad('2030-01-10', null)).rejects.toMatchObject({
      status: 500,
    });
  });

  it('una respuesta con otra forma se trata como error', async () => {
    responder(200, { algo: 'raro' });

    await expect(obtenerDisponibilidad('2030-01-10', null)).rejects.toBeInstanceOf(
      ErrorApi
    );
  });

  it('si no hay conexión falla con status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('red')));

    await expect(obtenerDisponibilidad('2030-01-10', null)).rejects.toMatchObject({
      status: 0,
    });
  });
});
