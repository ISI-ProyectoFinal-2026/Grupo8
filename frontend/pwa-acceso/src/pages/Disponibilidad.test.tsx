// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { TipoReserva } from '@/lib/tiposReserva';
import Disponibilidad from './Disponibilidad';

const DOMO: TipoReserva = {
  id: 't-domo',
  nombre: 'Domo geodésico',
  precio: 31700,
  forma_cobro: 'POR_UNIDAD',
  max_personas: 3,
  cantidad_unidades: 2,
};
const PARCELA: TipoReserva = {
  id: 't-parcela',
  nombre: 'Parcela premium',
  precio: 6300,
  forma_cobro: 'POR_PERSONA',
  max_personas: 8,
  cantidad_unidades: null,
};

function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <pre data-testid={nombre}>{JSON.stringify(location.state)}</pre>;
}

function mostrar(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/disponibilidad', state }]}>
      <Routes>
        <Route path="/" element={<p>Inicio</p>} />
        <Route path="/disponibilidad" element={<Disponibilidad />} />
        <Route path="/reservas" element={<Destino nombre="reservas" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Disponibilidad: resumen del tipo elegido (Issue 19.4)', () => {
  afterEach(cleanup);

  it('por persona muestra el precio del backend y que la disponibilidad se confirma al reservar', () => {
    mostrar({
      fecha: '2030-01-10',
      fechaEgreso: '2030-01-10',
      personas: '2',
      tipo: PARCELA,
    });

    expect(screen.getByText('Parcela premium')).toBeTruthy();
    expect(screen.getByText('$6.300 por persona')).toBeTruthy();
    expect(
      screen.getByText('La disponibilidad se confirma al reservar.')
    ).toBeTruthy();
    // Ya no afirma algo que no verificó
    expect(screen.queryByText(/Hay disponibilidad/)).toBeNull();
  });

  it('por unidad muestra el total estimado: precio × noches', () => {
    mostrar({
      fecha: '2030-01-10',
      fechaEgreso: '2030-01-13',
      personas: '2',
      tipo: DOMO,
    });

    expect(screen.getByText('$31.700 por noche')).toBeTruthy();
    expect(screen.getByText('$95.100')).toBeTruthy();
    expect(screen.getByText(/3 noches/, { selector: 'div' })).toBeTruthy();
  });

  it('continúa a Reservas con el tipo completo', () => {
    mostrar({
      fecha: '2030-01-10',
      fechaEgreso: '2030-01-11',
      personas: '2',
      tipo: DOMO,
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Continuar con la reserva' })
    );

    expect(
      JSON.parse(screen.getByTestId('reservas').textContent ?? '')
    ).toEqual({
      fecha: '2030-01-10',
      fechaEgreso: '2030-01-11',
      personas: '2',
      tipo: DOMO,
    });
  });

  it.each([
    [undefined],
    [{ fecha: '2030-01-10', personas: '2', tipo: 'cabana' }],
  ])('sin los datos de la búsqueda vuelve al inicio (%o)', (state) => {
    mostrar(state);

    expect(screen.getByText('Inicio')).toBeTruthy();
  });
});
