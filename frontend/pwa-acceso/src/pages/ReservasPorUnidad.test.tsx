// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { UsuarioSesion } from '@/lib/auth';
import type { Cotizacion } from '@/lib/cotizacion';
import { leerReservaPendiente } from '@/lib/reservaPendiente';
import type { TipoReserva } from '@/lib/tiposReserva';
import Reservas from './Reservas';

// Tipo por unidad como lo devuelve GET /api/v1/tipos-reserva
const DOMO: TipoReserva = {
  id: 't-domo',
  nombre: 'Domo geodésico',
  precio: 31700,
  forma_cobro: 'POR_UNIDAD',
  max_personas: 3,
  cantidad_unidades: 2,
};

const COTIZACION_POR_UNIDAD: Cotizacion = {
  moneda: 'ARS',
  subtotal: 95100,
  descuento_total: 0,
  total: 95100,
  cantidad_socios: 0,
  detalle: [],
  forma_cobro: 'POR_UNIDAD',
  precio_unitario: 31700,
  noches: 3,
};

// Lo que responde el backend al cotizar la cabaña con el DNI de un socio vigente (20 %)
const COTIZACION_CON_DESCUENTO: Cotizacion = {
  ...COTIZACION_POR_UNIDAD,
  descuento_total: 19020,
  total: 76080,
  cantidad_socios: 1,
  descuento_pct: 20,
};

const DNI_SOCIO = '30111222';

type ValidacionDni = { valido: boolean; motivo: string | null; nombre: string | null; condicion: string | null };
const SOCIO_VIGENTE: ValidacionDni = { valido: true, motivo: null, nombre: 'Marta Socia', condicion: 'socio' };
const CUOTA_VENCIDA: ValidacionDni = { valido: false, motivo: 'CUOTA_VENCIDA', nombre: null, condicion: null };

const USUARIO: UsuarioSesion = {
  id: 'u-1',
  nombre: 'Laura Díaz',
  email: 'laura@test.com',
  dni: '30111222',
  rol: 'CLIENTE',
  is_socio: false,
  membresia_vigente: false,
  membresia_vence: null,
};

type RespuestaCotizacion = Cotizacion | { status: number; detail: string };

function simularBackend({
  cotizacion = COTIZACION_POR_UNIDAD,
  usuario,
  socios = {},
}: {
  cotizacion?: RespuestaCotizacion;
  usuario?: UsuarioSesion;
  // Respuesta de GET /socios/validar/{dni} para cada DNI
  socios?: Record<string, ValidacionDni>;
} = {}) {
  const fetchFalso = vi.fn().mockImplementation(async (url: string, opciones?: RequestInit) => {
    const ruta = String(url);
    if (ruta.includes('/socios/validar/')) {
      const respuesta = socios[ruta.split('/socios/validar/')[1]];
      if (!respuesta) throw new Error(`Llamada inesperada a ${ruta}`);
      return { ok: true, json: async () => respuesta };
    }
    if (ruta.endsWith('/reservas/cotizar')) {
      // Con el DNI de un socio verificado el backend devuelve la cotización con descuento
      if (!('detail' in cotizacion) && JSON.parse(String(opciones?.body)).dni_titular)
        return { ok: true, json: async () => COTIZACION_CON_DESCUENTO };
      if ('detail' in cotizacion)
        return {
          ok: false,
          status: cotizacion.status,
          json: async () => ({ detail: cotizacion.detail }),
        };
      return { ok: true, json: async () => cotizacion };
    }
    if (ruta.endsWith('/auth/me')) {
      if (!usuario) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => usuario };
    }
    if (ruta.endsWith('/reservas/'))
      return {
        ok: true,
        json: async () => ({
          id: 'r-1',
          vencimiento_pago: '2030-01-01T12:10:00+00:00',
        }),
      };
    throw new Error(`Llamada inesperada a ${ruta}`);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

function mostrar(personas = '2') {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/reservas',
          state: {
            fecha: '2030-01-10',
            fechaEgreso: '2030-01-13',
            personas,
            tipo: DOMO,
          },
        },
      ]}
    >
      <AuthProvider>
        <Reservas />
      </AuthProvider>
    </MemoryRouter>
  );
}

const llamadasA = (fetchFalso: ReturnType<typeof vi.fn>, ruta: string) =>
  fetchFalso.mock.calls.filter(([url]) => String(url).endsWith(ruta));

function completarEmail(contenedor: HTMLElement) {
  fireEvent.change(contenedor.querySelector('input[type="email"]')!, {
    target: { value: 'laura@test.com' },
  });
  fireEvent.change(contenedor.querySelector('#email-confirmacion')!, {
    target: { value: 'laura@test.com' },
  });
}

const campoTitular = () =>
  screen.getByLabelText('Nombre completo del titular') as HTMLInputElement;
const campoCantidad = () =>
  screen.getByLabelText(/Cantidad de personas/) as HTMLInputElement;
const campoDni = () =>
  screen.getByLabelText(/DNI del titular si es socio/) as HTMLInputElement;
const botonPagar = () =>
  screen.getByRole('button', { name: /Pagar con Mercado Pago/ });

describe('Reservas por unidad (Issue 19.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('pide solo el titular y la cantidad de personas, sin la lista de personas', () => {
    simularBackend();
    mostrar();

    expect(campoTitular()).toBeTruthy();
    expect(campoCantidad().value).toBe('2');
    expect(screen.getByText('Cantidad de personas (máx. 3)')).toBeTruthy();
    expect(screen.queryByText(/Visitante 1/)).toBeNull();
    // Solo el DNI opcional del titular; no el de cada persona
    expect(screen.queryByText('DNI (Obligatorio para socios)')).toBeNull();
    expect(campoDni().value).toBe('');
    expect(screen.queryByText('Edad')).toBeNull();
  });

  it('cotiza con el tipo, la cantidad y las fechas, y muestra precio × noches', async () => {
    const fetchFalso = simularBackend();
    mostrar();

    await waitFor(() =>
      expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1)
    );
    expect(
      JSON.parse(llamadasA(fetchFalso, '/reservas/cotizar')[0][1].body)
    ).toEqual({
      tipo_reserva_id: DOMO.id,
      cantidad_personas: 2,
      fecha_ingreso: '2030-01-10',
      fecha_egreso: '2030-01-13',
    });
    expect(await screen.findByText('$31.700 × 3 noches')).toBeTruthy();
    expect(screen.getAllByText('$95.100').length).toBeGreaterThan(0);
  });

  it('vuelve a cotizar cuando cambia la cantidad y no cotiza si supera el máximo del tipo', async () => {
    const fetchFalso = simularBackend();
    mostrar();
    await waitFor(() =>
      expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1)
    );

    fireEvent.change(campoCantidad(), { target: { value: '3' } });
    await waitFor(() =>
      expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(2)
    );

    fireEvent.change(campoCantidad(), { target: { value: '4' } });
    expect(
      await screen.findByText(
        'Completá la cantidad de personas para ver el precio.'
      )
    ).toBeTruthy();
    expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(2);
  });

  it('muestra el motivo del backend si no se puede cotizar', async () => {
    simularBackend({
      cotizacion: {
        status: 422,
        detail: 'El tipo de reserva no existe o no está disponible.',
      },
    });
    mostrar();

    expect(
      await screen.findByText(
        'El tipo de reserva no existe o no está disponible.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Revisá tu conexión/)).toBeNull();
  });

  it('crea la reserva con titular y cantidad, sin personas', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrar();
    completarEmail(container);
    fireEvent.change(campoTitular(), { target: { value: 'Laura Díaz' } });

    fireEvent.click(botonPagar());

    await waitFor(() =>
      expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1)
    );
    const cuerpo = JSON.parse(llamadasA(fetchFalso, '/reservas/')[0][1].body);
    expect(cuerpo).toEqual({
      tipo_reserva_id: DOMO.id,
      fecha_ingreso: '2030-01-10',
      fecha_egreso: '2030-01-13',
      titular: 'Laura Díaz',
      cantidad_personas: 2,
      email: 'laura@test.com',
    });
    await waitFor(() =>
      expect(leerReservaPendiente()?.titulo).toBe('Domo geodésico - 2 personas')
    );
  });

  it('no envía nada sin titular o con más personas que el máximo', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrar();
    completarEmail(container);
    fireEvent.change(campoCantidad(), { target: { value: '5' } });

    fireEvent.click(botonPagar());

    expect(await screen.findByText('El nombre es obligatorio.')).toBeTruthy();
    expect(
      screen.getByText('Domo geodésico admite como máximo 3 personas.')
    ).toBeTruthy();
    expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(0);
  });

  it('con el DNI de un socio vigente cotiza con descuento y lo muestra en el resumen', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: SOCIO_VIGENTE } });
    mostrar();
    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1));

    fireEvent.change(campoDni(), { target: { value: DNI_SOCIO } });

    expect(await screen.findByText('Socio verificado: Marta Socia.')).toBeTruthy();
    expect(await screen.findByText('Descuento de socio (20%)')).toBeTruthy();
    expect(screen.getByText('-$19.020')).toBeTruthy();
    expect(screen.getAllByText('$76.080').length).toBeGreaterThan(0);
    const cotizaciones = llamadasA(fetchFalso, '/reservas/cotizar');
    expect(JSON.parse(cotizaciones[cotizaciones.length - 1][1].body)).toEqual({
      tipo_reserva_id: DOMO.id,
      cantidad_personas: 2,
      fecha_ingreso: '2030-01-10',
      fecha_egreso: '2030-01-13',
      dni_titular: DNI_SOCIO,
    });
  });

  it('un DNI que no es de socio vigente muestra el motivo y no se pide descuento', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: CUOTA_VENCIDA } });
    mostrar();
    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1));

    fireEvent.change(campoDni(), { target: { value: DNI_SOCIO } });

    expect(await screen.findByText(/La cuota de este socio está vencida/)).toBeTruthy();
    expect(screen.queryByText(/Descuento de socio/)).toBeNull();
    expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1);
  });

  it('crea la reserva con el DNI del titular cuando es socio vigente', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: SOCIO_VIGENTE } });
    const { container } = mostrar();
    completarEmail(container);
    fireEvent.change(campoTitular(), { target: { value: 'Marta Socia' } });
    fireEvent.change(campoDni(), { target: { value: DNI_SOCIO } });
    await screen.findByText('Socio verificado: Marta Socia.');

    fireEvent.click(botonPagar());

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1));
    expect(JSON.parse(llamadasA(fetchFalso, '/reservas/')[0][1].body)).toEqual({
      tipo_reserva_id: DOMO.id,
      fecha_ingreso: '2030-01-10',
      fecha_egreso: '2030-01-13',
      titular: 'Marta Socia',
      cantidad_personas: 2,
      dni_titular: DNI_SOCIO,
      email: 'laura@test.com',
    });
  });

  it('con un DNI que no es de socio vigente no crea la reserva', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: CUOTA_VENCIDA } });
    const { container } = mostrar();
    completarEmail(container);
    fireEvent.change(campoTitular(), { target: { value: 'Marta Socia' } });
    fireEvent.change(campoDni(), { target: { value: DNI_SOCIO } });

    fireEvent.click(botonPagar());

    expect(await screen.findByText(/La cuota de este socio está vencida/)).toBeTruthy();
    expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(0);
  });

  it('con el DNI mal escrito avisa el formato y no crea la reserva', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrar();
    completarEmail(container);
    fireEvent.change(campoTitular(), { target: { value: 'Marta Socia' } });
    fireEvent.change(campoDni(), { target: { value: '12345' } });

    fireEvent.click(botonPagar());

    expect(await screen.findByText('El DNI debe tener 7 u 8 dígitos, sin puntos.')).toBeTruthy();
    expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(0);
    expect(llamadasA(fetchFalso, '/socios/validar/12345')).toHaveLength(0);
  });

  it('sin DNI no consulta socios y reserva sin descuento', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrar();
    completarEmail(container);
    fireEvent.change(campoTitular(), { target: { value: 'Laura Díaz' } });

    fireEvent.click(botonPagar());

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1));
    expect(fetchFalso.mock.calls.some(([url]) => String(url).includes('/socios/validar'))).toBe(false);
    expect(JSON.parse(llamadasA(fetchFalso, '/reservas/')[0][1].body)).not.toHaveProperty('dni_titular');
  });

  it('un socio con sesión y cuota al día trae su DNI y no hace falta verificarlo', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    const fetchFalso = simularBackend({
      usuario: { ...USUARIO, is_socio: true, membresia_vigente: true },
    });

    mostrar();

    await waitFor(() => expect(campoDni().value).toBe(USUARIO.dni));
    await waitFor(() => {
      const cotizaciones = llamadasA(fetchFalso, '/reservas/cotizar');
      expect(JSON.parse(cotizaciones[cotizaciones.length - 1][1].body).dni_titular).toBe(USUARIO.dni);
    });
    expect(fetchFalso.mock.calls.some(([url]) => String(url).includes('/socios/validar'))).toBe(false);
  });

  it('con sesión de cliente precarga el titular y el email', async () => {
    localStorage.setItem(TOKEN_KEY, crearToken());
    simularBackend({ usuario: USUARIO });

    mostrar();

    await waitFor(() => expect(campoTitular().value).toBe('Laura Díaz'));
  });
});

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({
    sub: 'u-1',
    rol: 'CLIENTE',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}
