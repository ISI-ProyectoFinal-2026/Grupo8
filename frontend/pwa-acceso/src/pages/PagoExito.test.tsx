// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import {
  ErrorEstadoPago,
  consultarEstadoPago,
  type EstadoPagoRetorno,
  type EstadoRetorno,
} from '@/lib/estadoPago';
import {
  guardarReservaPendiente,
  leerReservaPendiente,
} from '@/lib/reservaPendiente';
import PagoExito, { INTERVALO_REINTENTO_MS, MAX_INTENTOS } from './PagoExito';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se aísla.
vi.mock('./ControlAcceso', () => ({ default: () => null }));

// Se espía la descarga del archivo; el resto de misReservas queda igual
const guardarArchivo = vi.fn();
vi.mock('@/lib/misReservas', async (original) => ({
  ...(await original<typeof import('@/lib/misReservas')>()),
  guardarArchivo: (...args: unknown[]) => guardarArchivo(...args),
}));

// La consulta del estado se simula; ErrorEstadoPago queda el real
vi.mock('@/lib/estadoPago', async (original) => ({
  ...(await original<typeof import('@/lib/estadoPago')>()),
  consultarEstadoPago: vi.fn(),
}));

const RESERVA_ID = '9de0ffbe-77ef-4b1c-8d4b-58f0beb138b7';

// Query params que Mercado Pago agrega al volver con un pago aprobado
const RUTA_RETORNO_EXITOSO =
  '/pago/exito?collection_id=123456789&collection_status=approved' +
  '&payment_id=123456789&status=approved' +
  `&external_reference=${RESERVA_ID}` +
  '&payment_type=credit_card&merchant_order_id=1&preference_id=abc&site_id=MLA';

function resultado(estado: EstadoRetorno, mensaje = ''): EstadoPagoRetorno {
  return {
    estado,
    mensaje,
    reserva: {
      id: RESERVA_ID,
      codigo: '#9de0ffbe',
      fecha_ingreso: '2099-12-20',
      fecha_egreso: '2099-12-22',
      cantidad_personas: 3,
    },
  };
}

const consultar = vi.mocked(consultarEstadoPago);

function mostrar(ruta = RUTA_RETORNO_EXITOSO) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/pago/exito" element={<PagoExito />} />
      </Routes>
    </MemoryRouter>
  );
}

const textoDeExito = () => screen.queryByText(/pago fue acreditado/i);

function guardarPendiente() {
  guardarReservaPendiente({
    id: RESERVA_ID,
    vencimiento: '2099-12-01T10:00:00Z',
    titulo: 'Entrada general',
  });
}

beforeEach(() => {
  consultar.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  guardarArchivo.mockReset();
  window.history.pushState({}, '', '/');
});

describe('Pantalla 5 - Reserva realizada: muestra el estado real', () => {
  it('consulta el estado con la reserva y el pago de la URL', async () => {
    consultar.mockResolvedValue(resultado('confirmada'));
    mostrar();

    await screen.findByText(/reserva realizada/i);
    expect(consultar).toHaveBeenCalledWith({
      reservaId: RESERVA_ID,
      paymentId: '123456789',
    });
  });

  it('confirmada: muestra los datos de la reserva, la reserva confirmada y el pago acreditado', async () => {
    guardarPendiente();
    consultar.mockResolvedValue(resultado('confirmada'));
    mostrar();

    expect(await screen.findByText('¡Reserva Realizada!')).toBeTruthy();
    expect(textoDeExito()).toBeTruthy();
    expect(screen.getByText('#9de0ffbe')).toBeTruthy();
    expect(screen.getByText('20/12/2099 al 22/12/2099')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Confirmada')).toBeTruthy();
    expect(screen.getByText('Acreditado')).toBeTruthy();
    expect(screen.getByRole('button', { name: /descargar qr/i })).toBeTruthy();
    // Ya pagada: no se ofrece pagarla otra vez
    expect(leerReservaPendiente()).toBeNull();
  });

  it('la ruta /pago/exito de la app (back_url de MP) muestra la Pantalla 5', async () => {
    consultar.mockResolvedValue(resultado('confirmada'));
    window.history.pushState({}, '', RUTA_RETORNO_EXITOSO);

    render(<App />);

    expect(await screen.findByText(/reserva realizada/i)).toBeTruthy();
  });

  it('mientras consulta no muestra el mensaje de éxito', () => {
    consultar.mockReturnValue(new Promise(() => {}));
    mostrar();

    expect(screen.getByText('Estamos confirmando tu pago')).toBeTruthy();
    expect(textoDeExito()).toBeNull();
  });

  it.each([
    ['sin datos', '/pago/exito'],
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
  ])(
    '%s: no muestra éxito, explica el problema y ofrece volver a intentar',
    (_, ruta) => {
      mostrar(ruta);

      expect(textoDeExito()).toBeNull();
      expect(screen.queryByText(/reserva realizada/i)).toBeNull();
      expect(screen.getByRole('alert').textContent).toMatch(
        /no pudimos identificar tu reserva/i
      );
      expect(
        screen
          .getByRole('link', { name: /volver a intentar/i })
          .getAttribute('href')
      ).toBe('/reservas');
      expect(consultar).not.toHaveBeenCalled();
    }
  );

  it('datos que no coinciden: no muestra éxito', async () => {
    consultar.mockRejectedValue(
      new ErrorEstadoPago(
        'No encontramos un pago de Mercado Pago para esta reserva.',
        'datos'
      )
    );
    mostrar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no encontramos un pago/i);
    expect(screen.getByText('No pudimos confirmar tu pago')).toBeTruthy();
    expect(textoDeExito()).toBeNull();
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it('rechazada: muestra el motivo y vuelve a la pantalla de pago para reintentar', async () => {
    guardarPendiente();
    consultar.mockResolvedValue(
      resultado(
        'rechazado',
        'El pago no fue aprobado. Tu reserva no está confirmada.'
      )
    );
    mostrar();

    expect(
      await screen.findByText('No pudimos confirmar tu pago')
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/no fue aprobado/i);
    expect(
      screen
        .getByRole('link', { name: /volver a intentar/i })
        .getAttribute('href')
    ).toBe('/reservas/pagar');
    expect(textoDeExito()).toBeNull();
    // Se conserva para poder pagar de nuevo
    expect(leerReservaPendiente()).not.toBeNull();
  });

  it('cancelada: no muestra éxito', async () => {
    consultar.mockResolvedValue(
      resultado('cancelada', 'La reserva fue cancelada.')
    );
    mostrar();

    expect(await screen.findByText('Reserva cancelada')).toBeTruthy();
    expect(textoDeExito()).toBeNull();
  });

  it('importe en revisión: no muestra éxito', async () => {
    consultar.mockResolvedValue(
      resultado('revision', 'Tenemos que revisarlo.')
    );
    mostrar();

    expect(await screen.findByText('Estamos revisando tu pago')).toBeTruthy();
    expect(textoDeExito()).toBeNull();
  });
});

describe('Pago en proceso: reintento automático', () => {
  async function avanzar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('vuelve a consultar cada pocos segundos hasta que se confirma', async () => {
    vi.useFakeTimers();
    consultar
      .mockResolvedValueOnce(resultado('en_proceso'))
      .mockResolvedValueOnce(resultado('en_proceso'))
      .mockResolvedValueOnce(resultado('confirmada'));
    mostrar();
    await avanzar(0);

    expect(screen.getByText('Estamos confirmando tu pago')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/#9de0ffbe/);
    expect(textoDeExito()).toBeNull();

    await avanzar(INTERVALO_REINTENTO_MS);
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(textoDeExito()).toBeNull();

    await avanzar(INTERVALO_REINTENTO_MS);
    expect(consultar).toHaveBeenCalledTimes(3);
    expect(textoDeExito()).toBeTruthy();

    // Confirmada, deja de consultar
    for (let i = 0; i < 3; i++) {
      await avanzar(INTERVALO_REINTENTO_MS);
    }
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it('una falla pasajera no corta el reintento', async () => {
    vi.useFakeTimers();
    consultar
      .mockRejectedValueOnce(new ErrorEstadoPago('Sin conexión', 'temporal'))
      .mockResolvedValueOnce(resultado('confirmada'));
    mostrar();
    await avanzar(0);
    expect(textoDeExito()).toBeNull();

    await avanzar(INTERVALO_REINTENTO_MS);

    expect(textoDeExito()).toBeTruthy();
  });

  it('el reintento tiene un límite y después se puede consultar a mano', async () => {
    vi.useFakeTimers();
    consultar.mockResolvedValue(resultado('en_proceso'));
    mostrar();

    await avanzar(0);
    for (let i = 0; i < MAX_INTENTOS + 5; i++) {
      await avanzar(INTERVALO_REINTENTO_MS);
    }

    expect(consultar).toHaveBeenCalledTimes(MAX_INTENTOS);
    expect(screen.getByText('Tu pago todavía se está procesando')).toBeTruthy();
    expect(textoDeExito()).toBeNull();

    consultar.mockResolvedValue(resultado('confirmada'));
    fireEvent.click(
      screen.getByRole('button', { name: /consultar de nuevo/i })
    );
    await avanzar(0);

    expect(textoDeExito()).toBeTruthy();
  });
});

// ---------- Descargar QR (ya con la reserva confirmada) ----------

function respuesta(status: number, cuerpo: Blob | null = null) {
  return {
    ok: status < 400,
    status,
    blob: async () => cuerpo ?? new Blob(),
  } as unknown as Response;
}

/** Simula el backend del QR con las respuestas indicadas, en orden. */
function simularApi(...respuestas: Array<Response | Error>) {
  const fetchFalso = vi.fn();
  for (const r of respuestas) {
    if (r instanceof Error) fetchFalso.mockRejectedValueOnce(r);
    else fetchFalso.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

async function mostrarConfirmada() {
  consultar.mockResolvedValue(resultado('confirmada'));
  mostrar();
  return (await screen.findByRole('button', {
    name: /descargar qr/i,
  })) as HTMLButtonElement;
}

describe('Cartel de contacto en el pago exitoso (31.3)', () => {
  it('con la reserva confirmada muestra el cartel que lleva a Contacto', async () => {
    await mostrarConfirmada();

    expect(screen.getByText('¿No te llegó el mail?')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /contactanos/i }).getAttribute('href')
    ).toBe('/contacto');
  });

  it('no aparece mientras se confirma el pago', () => {
    consultar.mockReturnValue(new Promise(() => {}));
    mostrar();

    expect(screen.queryByText('¿No te llegó el mail?')).toBeNull();
  });
});

describe('Descargar QR desde la pantalla de pago exitoso', () => {
  it('descarga el QR con la reserva y el pago que devuelve Mercado Pago, sin sesión', async () => {
    const fetchFalso = simularApi(
      respuesta(200, new Blob(['png'], { type: 'image/png' }))
    );
    fireEvent.click(await mostrarConfirmada());

    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledTimes(1));
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toContain(
      `/reservas/${RESERVA_ID}/qr-pago?payment_id=123456789`
    );
    expect(init).toBeUndefined(); // sin encabezado de autorización
    expect(guardarArchivo.mock.calls[0][1]).toBe(`QR_Acceso_${RESERVA_ID}.png`);
  });

  it('si el QR todavía no está listo avisa y deja reintentar', async () => {
    simularApi(respuesta(409), respuesta(200, new Blob(['png'])));
    const boton = await mostrarConfirmada();

    fireEvent.click(boton);
    expect(await screen.findByText(/todavía se está generando/i)).toBeTruthy();
    await waitFor(() => expect(boton.disabled).toBe(false));

    fireEvent.click(boton);
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledTimes(1));
  });

  it('si falla la descarga avisa que el QR llega por correo', async () => {
    simularApi(new TypeError('Failed to fetch'));
    fireEvent.click(await mostrarConfirmada());

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no pudimos descargar el qr/i);
    expect(alerta.textContent).toMatch(/correo/i);
  });
});
