// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import PagoPendiente from './PagoPendiente';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se aísla.
vi.mock('./ControlAcceso', () => ({ default: () => null }));

// Query params que Mercado Pago agrega al volver con un pago pendiente
const RUTA_RETORNO_PENDIENTE =
  '/pago/pendiente?collection_id=123456789&collection_status=pending' +
  '&payment_id=123456789&status=pending' +
  '&external_reference=9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7' +
  '&payment_type=ticket&merchant_order_id=1&preference_id=abc&site_id=MLA';

function expectSinEstadosAprobadoNiRechazado() {
  expect(screen.queryByText(/aprobad/i)).toBeNull();
  expect(screen.queryByText(/rechazad/i)).toBeNull();
  expect(screen.queryByText(/acreditad/i)).toBeNull();
  expect(screen.queryByText(/reserva realizada/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /descargar qr/i })).toBeNull();
}

describe('Pantalla de pago pendiente (Issue #138)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renderiza el mensaje de pago pendiente al retornar de MP', () => {
    render(
      <MemoryRouter initialEntries={[RUTA_RETORNO_PENDIENTE]}>
        <Routes>
          <Route path="/pago/pendiente" element={<PagoPendiente />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/pago pendiente/i)).toBeTruthy();
    expect(screen.getByText(/esperando la confirmación/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /volver al inicio/i })).toBeTruthy();
  });

  it('no presenta el pago como aprobado ni rechazado', () => {
    render(
      <MemoryRouter initialEntries={[RUTA_RETORNO_PENDIENTE]}>
        <Routes>
          <Route path="/pago/pendiente" element={<PagoPendiente />} />
        </Routes>
      </MemoryRouter>
    );

    expectSinEstadosAprobadoNiRechazado();
  });

  it('la ruta /pago/pendiente de la app (back_url de MP) muestra la pantalla', () => {
    window.history.pushState({}, '', RUTA_RETORNO_PENDIENTE);

    render(<App />);

    expect(screen.getByText(/pago pendiente/i)).toBeTruthy();
    expectSinEstadosAprobadoNiRechazado();
  });

  it('acceder directamente a /pago/pendiente, sin query params, no falla', () => {
    window.history.pushState({}, '', '/pago/pendiente');

    render(<App />);

    expect(screen.getByText(/pago pendiente/i)).toBeTruthy();
    expectSinEstadosAprobadoNiRechazado();
  });
});