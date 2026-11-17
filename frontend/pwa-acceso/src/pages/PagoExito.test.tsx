// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import PagoExito from './PagoExito';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se aísla.
vi.mock('./ControlAcceso', () => ({ default: () => null }));

// Se espía la descarga del archivo; el resto de misReservas queda igual
const guardarArchivo = vi.fn();
vi.mock('@/lib/misReservas', async (original) => ({
  ...(await original<typeof import('@/lib/misReservas')>()),
  guardarArchivo: (...args: unknown[]) => guardarArchivo(...args),
}));

// Query params que Mercado Pago agrega al volver con un pago aprobado
const RUTA_RETORNO_EXITOSO =
  '/pago/exito?collection_id=123456789&collection_status=approved' +
  '&payment_id=123456789&status=approved' +
  '&external_reference=9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7' +
  '&payment_type=credit_card&merchant_order_id=1&preference_id=abc&site_id=MLA';

describe('Pantalla 5 - Reserva realizada (Issue 12.1)', () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
    vi.unstubAllGlobals();
    guardarArchivo.mockReset();
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
    expect(
      screen.getByRole('link', { name: /volver al inicio/i })
    ).toBeTruthy();
    expect(screen.queryByText(/pago rechazado/i)).toBeNull();
  });

  it('la ruta /pago/exito de la app (back_url de MP) muestra la Pantalla 5', () => {
    window.history.pushState({}, '', RUTA_RETORNO_EXITOSO);

    render(<App />);

    expect(screen.getByText(/reserva realizada/i)).toBeTruthy();
  });
});

const RESERVA_ID = '9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7';

function mostrar(ruta = RUTA_RETORNO_EXITOSO) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/pago/exito" element={<PagoExito />} />
      </Routes>
    </MemoryRouter>
  );
}

function respuesta(status: number, cuerpo: Blob | null = null) {
  return {
    ok: status < 400,
    status,
    blob: async () => cuerpo ?? new Blob(),
  } as unknown as Response;
}

/** Simula el backend con las respuestas indicadas, en orden. */
function simularApi(...respuestas: Array<Response | Error>) {
  const fetchFalso = vi.fn();
  for (const r of respuestas) {
    if (r instanceof Error) fetchFalso.mockRejectedValueOnce(r);
    else fetchFalso.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

const botonDescargar = () =>
  screen.getByRole('button', { name: /descargar qr/i }) as HTMLButtonElement;

describe('Descargar QR desde la pantalla de pago exitoso', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    guardarArchivo.mockReset();
  });

  it('descarga el QR con la reserva y el pago que devuelve Mercado Pago, sin sesión', async () => {
    const fetchFalso = simularApi(
      respuesta(200, new Blob(['png'], { type: 'image/png' }))
    );
    mostrar();

    fireEvent.click(botonDescargar());

    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledTimes(1));
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toContain(
      `/reservas/${RESERVA_ID}/qr-pago?payment_id=123456789`
    );
    expect(init).toBeUndefined(); // sin encabezado de autorización
    expect(guardarArchivo.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(guardarArchivo.mock.calls[0][1]).toBe(`QR_Acceso_${RESERVA_ID}.png`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('si el QR todavía no está listo avisa y deja reintentar', async () => {
    const fetchFalso = simularApi(
      respuesta(409),
      respuesta(200, new Blob(['png']))
    );
    mostrar();

    fireEvent.click(botonDescargar());

    expect(
      await screen.findByText(
        'Tu QR todavía se está generando. Intentá de nuevo en unos segundos o revisá tu correo.'
      )
    ).toBeTruthy();
    expect(guardarArchivo).not.toHaveBeenCalled();
    await waitFor(() => expect(botonDescargar().disabled).toBe(false));

    fireEvent.click(botonDescargar());

    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledTimes(1));
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/todavía se está generando/i)).toBeNull();
  });

  it('si la reserva y el pago no coinciden muestra un error y avisa que el QR llega por correo', async () => {
    simularApi(respuesta(404));
    mostrar();

    fireEvent.click(botonDescargar());

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no encontramos el qr/i);
    expect(alerta.textContent).toMatch(/correo/i);
    expect(guardarArchivo).not.toHaveBeenCalled();
  });

  it.each([
    [
      'sin payment_id',
      `/pago/exito?status=approved&external_reference=${RESERVA_ID}`,
    ],
    [
      'sin external_reference',
      '/pago/exito?status=approved&payment_id=123456789',
    ],
    [
      'con payment_id "null"',
      `/pago/exito?payment_id=null&external_reference=${RESERVA_ID}`,
    ],
  ])('%s muestra un error claro y no intenta descargar', (_, ruta) => {
    const fetchFalso = simularApi();
    mostrar(ruta);

    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toMatch(/no pudimos identificar tu reserva/i);
    expect(alerta.textContent).toMatch(/correo/i);
    expect(botonDescargar().disabled).toBe(true);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('si no hay conexión muestra un error y avisa que el QR llega por correo', async () => {
    simularApi(new TypeError('Failed to fetch'));
    mostrar();

    fireEvent.click(botonDescargar());

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no pudimos descargar el qr/i);
    expect(alerta.textContent).toMatch(/correo/i);
  });
});
