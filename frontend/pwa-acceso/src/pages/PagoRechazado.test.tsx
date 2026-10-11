// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import PagoRechazado from './PagoRechazado';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se aísla.
vi.mock('./ControlAcceso', () => ({ default: () => null }));

// Query params que Mercado Pago agrega al volver con un pago rechazado
const rutaRetornoRechazado = (statusDetail: string) =>
  '/pago/rechazado?collection_id=123456789&collection_status=rejected' +
  '&payment_id=123456789&status=rejected' +
  `&status_detail=${statusDetail}` +
  '&external_reference=9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7' +
  '&payment_type=credit_card&merchant_order_id=1&preference_id=abc&site_id=MLA';

const MOTIVOS_RECHAZO = [
  'cc_rejected_insufficient_amount', // fondos insuficientes
  'cc_rejected_call_for_authorize', // falla de autorización / autenticación
];

function expectSinEstadoDeExito() {
  expect(screen.queryByText(/reserva realizada/i)).toBeNull();
  expect(screen.queryByText(/acreditad/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /descargar qr/i })).toBeNull();
}

describe('Pantalla 6 - Pago rechazado (Issue 12.2)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it.each(MOTIVOS_RECHAZO)(
    'muestra el rechazo y la opción de reintentar al retornar de MP (%s)',
    (motivo) => {
      render(
        <MemoryRouter initialEntries={[rutaRetornoRechazado(motivo)]}>
          <Routes>
            <Route path="/pago/rechazado" element={<PagoRechazado />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText(/pago rechazado/i)).toBeTruthy();
      expect(screen.getByText(/no pudimos procesar el pago/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /intentar nuevamente/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /volver al inicio/i })).toBeTruthy();
      expectSinEstadoDeExito();
    }
  );

  it.each(MOTIVOS_RECHAZO)(
    'la ruta /pago/rechazado de la app (back_url de MP) muestra la Pantalla 6 (%s)',
    (motivo) => {
      window.history.pushState({}, '', rutaRetornoRechazado(motivo));

      render(<App />);

      expect(screen.getByText(/pago rechazado/i)).toBeTruthy();
      expect(screen.getByText(/no pudimos procesar el pago/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /intentar nuevamente/i })).toBeTruthy();
      expectSinEstadoDeExito();
    }
  );

  it('"Intentar nuevamente" vuelve a la pantalla anterior para reintentar el pago', () => {
    render(
      <MemoryRouter
        initialEntries={['/reservas', rutaRetornoRechazado(MOTIVOS_RECHAZO[0])]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/reservas" element={<div>Formulario de reserva</div>} />
          <Route path="/pago/rechazado" element={<PagoRechazado />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /intentar nuevamente/i }));

    expect(screen.getByText('Formulario de reserva')).toBeTruthy();
    expect(screen.queryByText(/pago rechazado/i)).toBeNull();
  });

  it('"Volver al inicio" enlaza a la home', () => {
    render(
      <MemoryRouter initialEntries={[rutaRetornoRechazado(MOTIVOS_RECHAZO[0])]}>
        <Routes>
          <Route path="/pago/rechazado" element={<PagoRechazado />} />
        </Routes>
      </MemoryRouter>
    );

    const enlace = screen.getByRole('link', { name: /volver al inicio/i });
    expect(enlace.getAttribute('href')).toBe('/');
  });

  it('acceder directamente a /pago/rechazado, sin query params, no falla', () => {
    window.history.pushState({}, '', '/pago/rechazado');

    render(<App />);

    expect(screen.getByText(/pago rechazado/i)).toBeTruthy();
    expectSinEstadoDeExito();
  });
});
