// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import PagoExito from './PagoExito';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se aísla.
vi.mock('./ControlAcceso', () => ({ default: () => null }));

// Query params que Mercado Pago agrega al volver con un pago aprobado
const RUTA_RETORNO_EXITOSO =
  '/pago/exito?collection_id=123456789&collection_status=approved' +
  '&payment_id=123456789&status=approved' +
  '&external_reference=9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7' +
  '&payment_type=credit_card&merchant_order_id=1&preference_id=abc&site_id=MLA';

describe('Pantalla 5 - Reserva realizada (Issue 12.1)', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renderiza la pantalla de reserva realizada al retornar de MP con pago aprobado', () => {
    render(
      <MemoryRouter initialEntries={[RUTA_RETORNO_EXITOSO]}>
        <Routes>
          <Route path="/pago/exito" element={<PagoExito />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/reserva realizada/i)).toBeTruthy();
    expect(screen.getByText(/pago fue acreditado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /descargar qr/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /volver al inicio/i })).toBeTruthy();
    expect(screen.queryByText(/pago rechazado/i)).toBeNull();
  });

  it('la ruta /pago/exito de la app (back_url de MP) muestra la Pantalla 5', () => {
    window.history.pushState({}, '', RUTA_RETORNO_EXITOSO);

    render(<App />);

    expect(screen.getByText(/reserva realizada/i)).toBeTruthy();
  });
});