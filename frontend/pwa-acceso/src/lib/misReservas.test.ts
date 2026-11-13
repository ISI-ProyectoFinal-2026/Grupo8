// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT } from '@/context/AuthContext';
import {
  agruparReservas,
  cancelarReserva,
  clasificarReserva,
  hoyISO,
  obtenerCondicionesCancelacion,
  obtenerMisReservas,
  type EstadoReserva,
} from './misReservas';

const HOY = '2030-06-15';

function reserva(estado_reserva: EstadoReserva, fecha_egreso: string, id = 'r') {
  return { id, estado_reserva, fecha_egreso };
}

describe('clasificarReserva', () => {
  it('una reserva cancelada va a canceladas, sin importar la fecha', () => {
    expect(clasificarReserva(reserva('Cancelada', '2031-01-01'), HOY)).toBe('cancelada');
    expect(clasificarReserva(reserva('Cancelada', '2020-01-01'), HOY)).toBe('cancelada');
  });

  it('una reserva pendiente va a pendientes', () => {
    expect(clasificarReserva(reserva('Pendiente', '2031-01-01'), HOY)).toBe('pendiente');
  });

  it('una reserva confirmada que todavía no terminó es próxima', () => {
    expect(clasificarReserva(reserva('Confirmada', '2030-07-01'), HOY)).toBe('proxima');
  });

  it('una reserva confirmada que egresa hoy sigue siendo próxima', () => {
    expect(clasificarReserva(reserva('Confirmada', HOY), HOY)).toBe('proxima');
  });

  it('una reserva confirmada cuyo egreso ya pasó se muestra como finalizada', () => {
    expect(clasificarReserva(reserva('Confirmada', '2030-06-14'), HOY)).toBe('finalizada');
  });

  it('una reserva marcada como finalizada va a finalizadas', () => {
    expect(clasificarReserva(reserva('Finalizada', '2030-06-01'), HOY)).toBe('finalizada');
  });
});

describe('agruparReservas', () => {
  it('reparte cada reserva en su pestaña', () => {
    const lista = [
      reserva('Pendiente', '2030-08-01', 'a'),
      reserva('Confirmada', '2030-08-01', 'b'),
      reserva('Confirmada', '2030-01-01', 'c'),
      reserva('Cancelada', '2030-08-01', 'd'),
    ] as Parameters<typeof agruparReservas>[0];

    const grupos = agruparReservas(lista, HOY);

    expect(grupos.pendiente.map((r) => r.id)).toEqual(['a']);
    expect(grupos.proxima.map((r) => r.id)).toEqual(['b']);
    expect(grupos.finalizada.map((r) => r.id)).toEqual(['c']);
    expect(grupos.cancelada.map((r) => r.id)).toEqual(['d']);
  });

  it('sin reservas deja las cuatro pestañas vacías', () => {
    expect(agruparReservas([], HOY)).toEqual({
      pendiente: [],
      proxima: [],
      finalizada: [],
      cancelada: [],
    });
  });
});

describe('hoyISO', () => {
  it('devuelve la fecha con ceros a la izquierda', () => {
    expect(hoyISO(new Date(2030, 0, 5))).toBe('2030-01-05');
    expect(hoyISO(new Date(2030, 11, 25))).toBe('2030-12-25');
  });
});

describe('obtenerMisReservas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide /reservas/mias con el token y sin mandar ningún id de usuario', async () => {
    const fetchFalso = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 'r-1' }] }));
    vi.stubGlobal('fetch', fetchFalso);

    const lista = await obtenerMisReservas('token-123');

    expect(lista).toEqual([{ id: 'r-1' }]);
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/reservas/mias')).toBe(true);
    expect(url).not.toContain('user_id');
    expect((opciones.headers as Record<string, string>).Authorization).toBe('Bearer token-123');
  });

  it('si el token venció avisa a la app para cerrar la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);

    await expect(obtenerMisReservas('vencido')).rejects.toMatchObject({ status: 401 });

    expect(escuchador).toHaveBeenCalledTimes(1);
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });

  it('ante otro error del servidor lanza un mensaje claro y no cierra la sesión', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);

    await expect(obtenerMisReservas('token')).rejects.toThrow(/no pudimos cargar tus reservas/i);

    expect(escuchador).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });
});

describe('cancelación de reservas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respuesta(status: number, cuerpo: unknown) {
    return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
  }

  it('pide las condiciones de la reserva con el token', async () => {
    const condiciones = {
      puede_cancelar: true,
      dias_minimos: 1,
      fecha_limite: '2099-01-09',
      porcentaje_devolucion: 100,
      monto_devolucion: 15000,
      mensaje: null,
    };
    const fetchFalso = vi.fn(async () => respuesta(200, condiciones));
    vi.stubGlobal('fetch', fetchFalso);

    expect(await obtenerCondicionesCancelacion('tok', 'r-1')).toEqual(condiciones);
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/reservas/r-1/cancelacion')).toBe(true);
    expect((opciones.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('cancela con POST y devuelve el resultado', async () => {
    const resultado = { id: 'r-1', estado_reserva: 'Cancelada', monto_devuelto: 15000 };
    const fetchFalso = vi.fn(async () => respuesta(200, resultado));
    vi.stubGlobal('fetch', fetchFalso);

    expect(await cancelarReserva('tok', 'r-1')).toEqual(resultado);
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith('/reservas/r-1/cancelar')).toBe(true);
    expect(opciones.method).toBe('POST');
  });

  it('un 422 trae el motivo del backend', async () => {
    const motivo = 'Lo sentimos, las reservas solo se pueden cancelar hasta 1 día antes del ingreso.';
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(422, { detail: motivo })));

    await expect(cancelarReserva('tok', 'r-1')).rejects.toMatchObject({ message: motivo, status: 422 });
  });

  it('una reserva de otro usuario (404) avisa que no se encontró', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(404, { detail: 'Reserva no encontrada.' })));

    await expect(obtenerCondicionesCancelacion('tok', 'r-1')).rejects.toMatchObject({
      message: 'No encontramos la reserva.',
      status: 404,
    });
  });

  it('un error del servidor usa un mensaje genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(500, { detail: 'Traceback...' })));

    await expect(cancelarReserva('tok', 'r-1')).rejects.toMatchObject({
      message: 'No pudimos cancelar la reserva. Intentá nuevamente.',
    });
  });

  it('con la sesión vencida avisa a la app para que la cierre', async () => {
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(401, {})));

    await expect(cancelarReserva('tok', 'r-1')).rejects.toMatchObject({ status: 401 });
    expect(escuchador).toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });
});
