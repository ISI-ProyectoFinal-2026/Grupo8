// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarReservaPendiente, leerReservaPendiente, type ReservaPendiente } from '@/lib/reservaPendiente';
import PagarReserva from './PagarReserva';

const AHORA = new Date('2026-11-10T17:00:00.000Z');

const RESERVA: ReservaPendiente = {
  id: 'r-1',
  vencimiento: '2026-11-10T17:10:00.000+00:00',
  titulo: 'Entrada General - 2 personas',
};

function mostrar(estado?: { reserva: ReservaPendiente }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/reservas/pagar', state: estado }]}>
      <Routes>
        <Route path="/reservas/pagar" element={<PagarReserva />} />
        <Route path="/" element={<div>Inicio</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Pantalla de pago con plazo (Issue 17.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('muestra la cuenta regresiva y el botón para pagar', () => {
    mostrar({ reserva: RESERVA });

    expect(screen.getByText(/tu reserva está guardada/i)).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('10:00');
    expect(screen.getByRole('button', { name: /ir a pagar/i })).toBeTruthy();
  });

  it('al llegar a cero avisa que la reserva venció y ofrece empezar de nuevo', () => {
    guardarReservaPendiente(RESERVA);
    mostrar({ reserva: RESERVA });

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(screen.getByText(/tu reserva venció/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ir a pagar/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /empezar de nuevo/i }));

    expect(screen.getByText('Inicio')).toBeTruthy();
    expect(leerReservaPendiente()).toBeNull();
  });

  it('al volver de Mercado Pago recupera la reserva guardada con el tiempo que queda', () => {
    guardarReservaPendiente(RESERVA);
    vi.setSystemTime(new Date('2026-11-10T17:07:30.000Z'));

    mostrar();

    expect(screen.getByRole('timer').textContent).toBe('02:30');
  });

  it('si la reserva guardada ya venció, lo muestra directamente', () => {
    guardarReservaPendiente(RESERVA);
    vi.setSystemTime(new Date('2026-11-10T17:15:00.000Z'));

    mostrar();

    expect(screen.getByText(/tu reserva venció/i)).toBeTruthy();
  });

  it('sin reserva para pagar ofrece volver al inicio', () => {
    mostrar();

    expect(screen.getByText(/no hay una reserva para pagar/i)).toBeTruthy();
  });

  it('"Ir a pagar" crea el link de Mercado Pago de esa reserva', async () => {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ init_point: 'https://mp.test/init' }),
    });
    vi.stubGlobal('fetch', fetchFalso);
    mostrar({ reserva: RESERVA });

    fireEvent.click(screen.getByRole('button', { name: /ir a pagar/i }));

    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/payments\/create$/);
    expect(JSON.parse(opciones.body)).toEqual({ title: RESERVA.titulo, reserva_id: 'r-1' });
  });

  it('si el backend responde que el plazo venció, muestra la reserva vencida', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: 'El plazo para pagar la reserva venció. Hacé una nueva reserva.' }),
      })
    );
    mostrar({ reserva: RESERVA });

    fireEvent.click(screen.getByRole('button', { name: /ir a pagar/i }));

    await waitFor(() => expect(screen.getByText(/tu reserva venció/i)).toBeTruthy());
  });

  it('si Mercado Pago falla, muestra el error y deja reintentar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: 'Rechazado por Mercado Pago' }) })
    );
    mostrar({ reserva: RESERVA });

    fireEvent.click(screen.getByRole('button', { name: /ir a pagar/i }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/rechazado por mercado pago/i));
    expect(screen.getByRole('button', { name: /ir a pagar/i })).toBeTruthy();
  });
});
