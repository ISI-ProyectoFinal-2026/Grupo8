// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      <Reservas />
    </MemoryRouter>
  );
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
