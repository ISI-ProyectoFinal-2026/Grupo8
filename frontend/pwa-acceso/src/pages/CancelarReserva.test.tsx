// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CondicionesCancelacion } from '@/lib/misReservas';
import CancelarReserva from './CancelarReserva';

const ENLACE_VENCIDO = 'El enlace venció. Pedí uno nuevo desde el botón de arrepentimiento.';
const FUERA_DE_PLAZO = 'Lo sentimos, las reservas solo se pueden cancelar hasta 7 días antes del ingreso.';

const CANCELABLE: CondicionesCancelacion = {
  puede_cancelar: true,
  dias_minimos: 7,
  fecha_limite: '2099-01-09',
  porcentaje_devolucion: 100,
  monto_devolucion: 15000,
  mensaje: null,
  arrepentimiento: true,
};

const CANCELADA = {
  id: 'reserva-0001',
  estado_reserva: 'Cancelada',
  estado_pago: 'Pagado',
  monto_devuelto: 15000,
  devolucion_realizada: true,
  mensaje: 'La reserva quedó cancelada. Te devolvimos $ 15.000,00 por Mercado Pago.',
  codigo_gestion: 'reserva-0001',
};

function respuesta(status: number, cuerpo: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo } as unknown as Response;
}

/** El GET responde con `alConsultar` y el POST con `alConfirmar`. */
function simularApi(
  alConsultar: () => Response | Promise<Response>,
  alConfirmar: () => Response | Promise<Response> = () => respuesta(200, CANCELADA)
) {
  const fetchFalso = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? alConfirmar() : alConsultar()
  );
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

function mostrar(ruta = '/cancelar-reserva?token=tok-1') {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/cancelar-reserva" element={<CancelarReserva />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Cancelar reserva desde el enlace del correo (25.3)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sin token avisa que el enlace no es válido y no llama al backend', () => {
    const fetchFalso = simularApi(() => respuesta(200, CANCELABLE));

    mostrar('/cancelar-reserva');

    expect(screen.getByRole('alert').textContent).toBe(
      'El enlace no es válido. Pedí uno nuevo desde el botón de arrepentimiento.'
    );
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' }).getAttribute('href')).toBe(
      '/arrepentimiento'
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('mientras pide las condiciones muestra que está cargando', () => {
    simularApi(() => new Promise(() => {}));

    mostrar();

    expect(screen.getByRole('status').textContent).toBe('Cargando condiciones…');
  });

  it('muestra las condiciones con los textos de §4 y consulta con el token del enlace', async () => {
    const fetchFalso = simularApi(() => respuesta(200, CANCELABLE));

    mostrar();

    expect(await screen.findByText('¿Está seguro que desea cancelar?')).toBeTruthy();
    expect(screen.getByText('Estás dentro del plazo de arrepentimiento: se te devuelve el total.')).toBeTruthy();
    expect(screen.getByText('100 % de lo que pagaste')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar cancelación' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Volver' }).getAttribute('href')).toBe('/');
    expect(fetchFalso.mock.calls[0][0]).toMatch(/\/arrepentimiento\/condiciones\?token=tok-1$/);
  });

  it('al confirmar muestra el resultado y el código de gestión', async () => {
    const fetchFalso = simularApi(() => respuesta(200, CANCELABLE));
    mostrar();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cancelación' }));

    expect(await screen.findByText(CANCELADA.mensaje)).toBeTruthy();
    expect(screen.getByText('Código de gestión:', { exact: false }).textContent).toContain('reserva-0001');
    expect(screen.getByRole('heading', { name: 'Reserva cancelada' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar cancelación' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toBeTruthy();
    const [, opciones] = fetchFalso.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(opciones.body as string)).toEqual({ token: 'tok-1' });
  });

  it('mientras confirma deshabilita el botón', async () => {
    simularApi(() => respuesta(200, CANCELABLE), () => new Promise(() => {}));
    mostrar();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cancelación' }));

    const boton = await screen.findByRole('button', { name: 'Cancelando…' });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
  });

  it('con el enlace vencido muestra el motivo y ofrece pedir otro', async () => {
    simularApi(() => respuesta(401, { detail: ENLACE_VENCIDO }));

    mostrar();

    expect((await screen.findByRole('alert')).textContent).toBe(ENLACE_VENCIDO);
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar cancelación' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  it('fuera de plazo muestra el mensaje del backend y solo "Volver"', async () => {
    simularApi(() =>
      respuesta(200, { ...CANCELABLE, puede_cancelar: false, arrepentimiento: false, mensaje: FUERA_DE_PLAZO })
    );

    mostrar();

    expect((await screen.findByRole('alert')).textContent).toBe(FUERA_DE_PLAZO);
    expect(screen.queryByRole('button', { name: 'Confirmar cancelación' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Volver' })).toBeTruthy();
  });

  it('si la confirmación es rechazada (enlace usado dos veces) muestra el motivo', async () => {
    simularApi(
      () => respuesta(200, CANCELABLE),
      () => respuesta(422, { detail: 'La reserva ya está cancelada.' })
    );
    mostrar();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cancelación' }));

    expect((await screen.findByRole('alert')).textContent).toBe('La reserva ya está cancelada.');
    expect(screen.queryByRole('button', { name: 'Confirmar cancelación' })).toBeNull();
  });

  it('si el enlace vence antes de confirmar ofrece pedir otro', async () => {
    simularApi(() => respuesta(200, CANCELABLE), () => respuesta(401, { detail: ENLACE_VENCIDO }));
    mostrar();

    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cancelación' }));

    expect((await screen.findByRole('alert')).textContent).toBe(ENLACE_VENCIDO);
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeTruthy();
  });

  it('si falla la consulta permite reintentar', async () => {
    let intentos = 0;
    simularApi(() => (++intentos === 1 ? respuesta(500) : respuesta(200, CANCELABLE)));
    mostrar();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos consultar las condiciones de cancelación. Intentá nuevamente.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('button', { name: 'Confirmar cancelación' })).toBeTruthy();
  });
});
