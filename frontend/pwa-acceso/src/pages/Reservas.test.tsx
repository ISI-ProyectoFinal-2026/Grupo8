// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { Cotizacion } from '@/lib/cotizacion';
import Reservas from './Reservas';

// Importes pensados para que NO salgan de ninguna cuenta local (ni 5000 ni 50 %):
// si la pantalla los muestra tal cual, es porque los trajo del backend.
const COTIZACION_DEL_BACKEND: Cotizacion = {
  moneda: 'ARS',
  subtotal: 17000,
  descuento_total: 2550,
  total: 14450,
  cantidad_socios: 0,
  detalle: [
    {
      indice: 0,
      condicion_efectiva: 'visitante',
      descuento_codigo: 'mayores',
      descuento_pct: 15,
      precio_base: 8500,
      precio_final: 7225,
    },
    {
      indice: 1,
      condicion_efectiva: 'visitante',
      descuento_codigo: 'mayores',
      descuento_pct: 15,
      precio_base: 8500,
      precio_final: 7225,
    },
  ],
};

function simularBackend(respuesta: Cotizacion | 'error' = COTIZACION_DEL_BACKEND) {
  const fetchFalso = vi.fn().mockImplementation(async (url: string) => {
    if (String(url).endsWith('/reservas/cotizar')) {
      if (respuesta === 'error') return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => respuesta };
    }
    throw new Error(`Llamada inesperada a ${url}`);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

function mostrarReservas(personas = '2') {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/reservas',
          state: { fecha: '2030-01-10', fechaEgreso: '2030-01-10', personas, tipo: 'carpa' },
        },
      ]}
    >
      <AuthProvider>
        <Reservas />
      </AuthProvider>
    </MemoryRouter>
  );
}

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'u-1', rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

// Los campos de edad son los únicos inputs numéricos de hasta 3 dígitos
function camposDeEdad(contenedor: HTMLElement) {
  return Array.from(
    contenedor.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"][maxlength="3"]')
  );
}

function cargarEdades(contenedor: HTMLElement, edades: string[]) {
  camposDeEdad(contenedor).forEach((campo, i) =>
    fireEvent.change(campo, { target: { value: edades[i] } })
  );
}

// Completa el formulario y aprieta "Pagar"; devuelve el fetch falso para mirar sus llamadas
async function reservar() {
  const fetchFalso = vi.fn().mockImplementation(async (url: string) => {
    const ruta = String(url);
    if (ruta.endsWith('/reservas/cotizar')) {
      return { ok: true, json: async () => COTIZACION_DEL_BACKEND };
    }
    if (ruta.endsWith('/reservas/')) return { ok: true, json: async () => ({ id: 'r-1' }) };
    if (ruta.endsWith('/api/payments/create')) return { ok: true, json: async () => ({}) };
    throw new Error(`Llamada inesperada a ${ruta}`);
  });
  vi.stubGlobal('fetch', fetchFalso);
  const { container } = mostrarReservas();

  fireEvent.change(container.querySelector('input[type="email"]')!, {
    target: { value: 'ana@test.com' },
  });
  const nombres = Array.from(container.querySelectorAll<HTMLInputElement>('input[maxlength="100"]'));
  fireEvent.change(nombres[0], { target: { value: 'Ana Pérez' } });
  fireEvent.change(nombres[1], { target: { value: 'Luis Pérez' } });
  cargarEdades(container, ['34', '8']);
  fireEvent.click(screen.getByRole('button', { name: /pagar con mercado pago/i }));

  await waitFor(() =>
    expect(fetchFalso.mock.calls.some(([url]) => String(url).endsWith('/reservas/'))).toBe(true)
  );
  return fetchFalso;
}

describe('Reservas: precio calculado por el backend', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('no cotiza ni muestra un precio mientras falten las edades', () => {
    const fetchFalso = simularBackend();

    mostrarReservas();

    expect(screen.getByText(/completá la edad de cada persona/i)).toBeTruthy();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('muestra el subtotal, el descuento y el total que devuelve el backend', async () => {
    simularBackend();
    const { container } = mostrarReservas();

    cargarEdades(container, ['70', '68']);

    await waitFor(() => expect(screen.getByText(/14\.450/)).toBeTruthy());
    expect(screen.getByText(/17\.000/)).toBeTruthy();
    expect(screen.getByText(/-\$2\.?550/)).toBeTruthy();
  });

  it('manda a cotizar la edad y la condición de cada persona', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrarReservas();

    cargarEdades(container, ['70', '68']);

    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
    const [, opciones] = fetchFalso.mock.calls[0];
    expect(JSON.parse(opciones.body)).toEqual({
      personas: [
        { edad: 70, condicion: 'visitante' },
        { edad: 68, condicion: 'visitante' },
      ],
    });
  });

  it('no muestra la fila de descuento si el backend no aplicó ninguno', async () => {
    simularBackend({
      ...COTIZACION_DEL_BACKEND,
      subtotal: 17000,
      descuento_total: 0,
      total: 17000,
    });
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);

    await waitFor(() => expect(screen.getAllByText(/17\.000/).length).toBeGreaterThan(0));
    expect(screen.queryByText('Descuentos')).toBeNull();
  });

  it('avisa si no se pudo calcular el precio y no inventa un importe', async () => {
    simularBackend('error');
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);

    await waitFor(() => expect(screen.getByText(/no pudimos calcular el precio/i)).toBeTruthy());
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('vuelve a cotizar cuando cambia una edad', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);
    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
    fireEvent.change(camposDeEdad(container)[0], { target: { value: '70' } });

    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchFalso.mock.calls[1][1].body).personas[0].edad).toBe(70);
  });
});

describe('Reservas: sin teléfono', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('no muestra ningún campo de teléfono', () => {
    simularBackend();
    const { container } = mostrarReservas();

    expect(container.querySelector('input[type="tel"]')).toBeNull();
    expect(screen.queryByText(/teléfono/i)).toBeNull();
  });

  it('crea la reserva sin mandar teléfono y sin pedirlo en la validación', async () => {
    const fetchFalso = await reservar();

    const llamada = fetchFalso.mock.calls.find(([url]) => String(url).endsWith('/reservas/'))!;
    const cuerpo = JSON.parse(llamada[1].body);
    expect(cuerpo).not.toHaveProperty('telefono');
    expect(cuerpo.email).toBe('ana@test.com');
    expect(cuerpo.personas).toHaveLength(2);
  });
});

describe('Reservas: con y sin sesión', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sin sesión reserva igual: no pide el usuario de prueba, no manda user_id ni Authorization', async () => {
    const fetchFalso = await reservar();

    const llamada = fetchFalso.mock.calls.find(([url]) => String(url).endsWith('/reservas/'))!;
    expect(JSON.parse(llamada[1].body)).not.toHaveProperty('user_id');
    expect(llamada[1].headers).not.toHaveProperty('Authorization');
    expect(fetchFalso.mock.calls.some(([url]) => String(url).includes('/usuarios/prueba'))).toBe(false);
  });

  it('con sesión manda el token para que el backend asocie la reserva, sin user_id', async () => {
    const token = crearToken();
    localStorage.setItem(TOKEN_KEY, token);

    const fetchFalso = await reservar();

    const llamada = fetchFalso.mock.calls.find(([url]) => String(url).endsWith('/reservas/'))!;
    expect(llamada[1].headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(llamada[1].body)).not.toHaveProperty('user_id');
  });
});
