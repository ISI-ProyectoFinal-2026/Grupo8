// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT } from '@/context/AuthContext';
import type {
  CondicionesCancelacion,
  ReservaDetalle,
  ResultadoCancelacion,
} from '@/lib/misReservas';
import DialogoCancelacion from './DialogoCancelacion';

const TOKEN = 'token-de-prueba';

const RESERVA: ReservaDetalle = {
  id: 'reserva-0001',
  fecha_reserva: '2030-01-01T10:00:00',
  fecha_ingreso: '2099-01-10',
  fecha_egreso: '2099-01-12',
  cantidad_personas: 2,
  cantidad_socios: 1,
  monto_total: 15000,
  titular: 'Ana Pérez',
  estado_reserva: 'Confirmada',
  estado_pago: 'Pagado',
  personas: [],
};

const DENTRO_DEL_PLAZO: CondicionesCancelacion = {
  puede_cancelar: true,
  dias_minimos: 2,
  fecha_limite: '2099-01-08',
  porcentaje_devolucion: 50,
  monto_devolucion: 7500,
  mensaje: null,
};

const FUERA_DEL_PLAZO: CondicionesCancelacion = {
  ...DENTRO_DEL_PLAZO,
  puede_cancelar: false,
  dias_minimos: 3,
  mensaje:
    'Lo sentimos, las reservas solo se pueden cancelar hasta 3 días antes del ingreso.',
};

const CANCELADA: ResultadoCancelacion = {
  id: RESERVA.id,
  estado_reserva: 'Cancelada',
  estado_pago: 'Pagado',
  monto_devuelto: 7500,
  devolucion_realizada: true,
  mensaje:
    'La reserva quedó cancelada. Te devolvimos $ 7.500,00 por Mercado Pago.',
};

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

/** Simula el backend: el GET devuelve `condiciones` y el POST lo que diga `alCancelar`. */
function simularApi(
  condiciones: CondicionesCancelacion,
  alCancelar: () => Response | Promise<Response> = () =>
    respuesta(200, CANCELADA)
) {
  const fetchFalso = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? alCancelar() : respuesta(200, condiciones)
  );
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

function mostrar(reserva: ReservaDetalle | null = RESERVA) {
  const onCerrar = vi.fn();
  const onCancelada = vi.fn();
  render(
    <DialogoCancelacion
      reserva={reserva}
      token={TOKEN}
      onCerrar={onCerrar}
      onCancelada={onCancelada}
    />
  );
  return { onCerrar, onCancelada };
}

describe('Diálogo de cancelación (Issue 22.3)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('cerrado no se muestra ni consulta al backend', () => {
    const fetchFalso = simularApi(DENTRO_DEL_PLAZO);

    mostrar(null);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('mientras pide las condiciones muestra que está cargando', async () => {
    simularApi(DENTRO_DEL_PLAZO);

    mostrar();

    expect(screen.getByText('Cargando condiciones…')).toBeTruthy();
    await screen.findByText('¿Está seguro que desea cancelar?');
    expect(screen.queryByText('Cargando condiciones…')).toBeNull();
  });

  it('dentro del plazo muestra el plazo, el porcentaje, el monto y la pregunta', async () => {
    const fetchFalso = simularApi(DENTRO_DEL_PLAZO);

    mostrar();

    expect(
      await screen.findByText('¿Está seguro que desea cancelar?')
    ).toBeTruthy();
    expect(
      screen.getByText('08/01/2099 (2 días antes del ingreso)')
    ).toBeTruthy();
    expect(screen.getByText('50 % de lo que pagaste')).toBeTruthy();
    expect(screen.getByText('$7.500')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Confirmar cancelación' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeTruthy();

    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.endsWith(`/reservas/${RESERVA.id}/cancelacion`)).toBe(true);
    expect((opciones.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it.each([
    [1, '08/01/2099 (1 día antes del ingreso)'],
    [0, '08/01/2099 (hasta el mismo día del ingreso)'],
  ])('con %i días explica el plazo en palabras', async (dias, texto) => {
    simularApi({ ...DENTRO_DEL_PLAZO, dias_minimos: dias });

    mostrar();

    expect(await screen.findByText(texto)).toBeTruthy();
  });

  it('fuera del plazo muestra el mensaje con N de la configuración y solo "Volver"', async () => {
    simularApi(FUERA_DEL_PLAZO);

    mostrar();

    expect(
      await screen.findByText(
        'Lo sentimos, las reservas solo se pueden cancelar hasta 3 días antes del ingreso.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('¿Está seguro que desea cancelar?')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Confirmar cancelación' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeTruthy();
  });

  it('"Volver" cierra el diálogo sin cancelar', async () => {
    const fetchFalso = simularApi(DENTRO_DEL_PLAZO);
    const { onCerrar, onCancelada } = mostrar();
    await screen.findByText('¿Está seguro que desea cancelar?');

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(onCancelada).not.toHaveBeenCalled();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('al confirmar cancela con el token y avisa el resultado', async () => {
    const fetchFalso = simularApi(DENTRO_DEL_PLAZO);
    const { onCancelada } = mostrar();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirmar cancelación' })
    );

    await vi.waitFor(() => expect(onCancelada).toHaveBeenCalledWith(CANCELADA));
    const [url, opciones] = fetchFalso.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.endsWith(`/reservas/${RESERVA.id}/cancelar`)).toBe(true);
    expect(opciones.method).toBe('POST');
    expect((opciones.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`
    );
  });

  it('mientras cancela el botón queda deshabilitado, así no se cancela dos veces', async () => {
    let responder: (r: Response) => void = () => {};
    const fetchFalso = simularApi(
      DENTRO_DEL_PLAZO,
      () => new Promise<Response>((resolve) => (responder = resolve))
    );
    const { onCancelada } = mostrar();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirmar cancelación' })
    );

    const boton = await screen.findByRole('button', { name: 'Cancelando…' });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(boton);
    expect(fetchFalso).toHaveBeenCalledTimes(2);

    responder(respuesta(200, CANCELADA));
    await vi.waitFor(() => expect(onCancelada).toHaveBeenCalledTimes(1));
  });

  it('si el backend rechaza la cancelación muestra el motivo y solo "Volver"', async () => {
    simularApi(DENTRO_DEL_PLAZO, () =>
      respuesta(422, {
        detail:
          'Lo sentimos, las reservas solo se pueden cancelar hasta 2 días antes del ingreso.',
      })
    );
    const { onCancelada } = mostrar();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirmar cancelación' })
    );

    expect(
      await screen.findByText(
        'Lo sentimos, las reservas solo se pueden cancelar hasta 2 días antes del ingreso.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Confirmar cancelación' })
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeTruthy();
    expect(onCancelada).not.toHaveBeenCalled();
  });

  it('si no puede cargar las condiciones avisa y permite reintentar', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta(500, {}))
      .mockResolvedValueOnce(respuesta(200, DENTRO_DEL_PLAZO));
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();

    expect(
      await screen.findByText(
        'No pudimos consultar las condiciones de cancelación. Intentá nuevamente.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Confirmar cancelación' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(
      await screen.findByText('¿Está seguro que desea cancelar?')
    ).toBeTruthy();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('sin conexión avisa que no pudo conectarse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    mostrar();

    expect(
      await screen.findByText(
        'No se pudo conectar con el servidor. Intentá nuevamente.'
      )
    ).toBeTruthy();
  });

  it('con la sesión vencida avisa a la app para que la cierre', async () => {
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(401, {}))
    );

    mostrar();

    await vi.waitFor(() => expect(escuchador).toHaveBeenCalled());
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });
});
