// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Inicio from './Inicio';
import { INTERVALO_ACTUALIZACION_MS } from '@/hooks/useOcupacion';
import {
  obtenerOcupacion,
  OcupacionApiError,
  type Ocupacion,
} from '@/services/ocupacionService';

// Se reemplaza solo la llamada a la red; la clase de error y mensajeDeError son los reales
vi.mock('@/services/ocupacionService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/ocupacionService')>();
  return { ...original, obtenerOcupacion: vi.fn() };
});
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'token-de-prueba' }),
  AUTH_EXPIRED_EVENT: 'qamp:auth-expired',
}));

const ocupacion = (actual: number, capacidad = 50, buffer = 5): Ocupacion => ({
  ocupacion_actual: actual,
  capacidad_maxima: capacidad,
  buffer_offline: buffer,
});

const barra = () => screen.getByRole('progressbar', { name: 'Ocupación del camping' });

describe('Monitor de ocupación en el inicio del panel', () => {
  beforeEach(() => {
    vi.mocked(obtenerOcupacion).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('muestra "cargando" mientras espera la respuesta', () => {
    vi.mocked(obtenerOcupacion).mockReturnValue(new Promise(() => {}));

    render(<Inicio />);

    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeTruthy();
    expect(screen.getByText('Cargando ocupación…')).toBeTruthy();
  });

  it('muestra ocupación, capacidad, porcentaje y buffer', async () => {
    vi.mocked(obtenerOcupacion).mockResolvedValue(ocupacion(30));

    render(<Inicio />);

    expect(await screen.findByText('/ 50 personas')).toBeTruthy();
    expect(screen.getByText('60 %')).toBeTruthy();
    expect(barra().getAttribute('aria-valuenow')).toBe('30');
    expect(barra().getAttribute('aria-valuemax')).toBe('50');
    expect(screen.getByText(/Buffer offline: 5 lugares reservados/)).toBeTruthy();
    expect(vi.mocked(obtenerOcupacion).mock.calls[0][0]).toBe('token-de-prueba');
  });

  it.each([
    [30, 'verde', 'Ocupación normal'],
    [40, 'amarillo', 'Ocupación alta'],
    [46, 'rojo', 'Ocupación crítica'],
  ])('con %i de 50 personas la barra es %s', async (actual, nivel, texto) => {
    vi.mocked(obtenerOcupacion).mockResolvedValue(ocupacion(actual));

    render(<Inicio />);

    expect(await screen.findByText(new RegExp(texto))).toBeTruthy();
    expect(barra().getAttribute('data-nivel')).toBe(nivel);
  });

  it('muestra el estado vacío cuando no hay nadie dentro', async () => {
    vi.mocked(obtenerOcupacion).mockResolvedValue(ocupacion(0));

    render(<Inicio />);

    expect(await screen.findByText('No hay personas dentro del camping.')).toBeTruthy();
    expect(barra().getAttribute('aria-valuenow')).toBe('0');
  });

  it('muestra el error y permite reintentar', async () => {
    vi.mocked(obtenerOcupacion)
      .mockRejectedValueOnce(new OcupacionApiError(500, 'Error interno'))
      .mockResolvedValueOnce(ocupacion(10));

    render(<Inicio />);

    expect(await screen.findByText(/No se pudo consultar la ocupación. Error interno/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('20 %')).toBeTruthy();
  });

  it('se actualiza sola cada 30 segundos', async () => {
    vi.useFakeTimers();
    vi.mocked(obtenerOcupacion)
      .mockResolvedValueOnce(ocupacion(10))
      .mockResolvedValueOnce(ocupacion(25));

    render(<Inicio />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('20 %')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ACTUALIZACION_MS);
    });

    expect(obtenerOcupacion).toHaveBeenCalledTimes(2);
    expect(screen.getByText('50 %')).toBeTruthy();
  });

  it('si falla una actualización, sigue mostrando los últimos datos', async () => {
    vi.useFakeTimers();
    vi.mocked(obtenerOcupacion)
      .mockResolvedValueOnce(ocupacion(10))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<Inicio />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ACTUALIZACION_MS);
    });

    expect(screen.getByText('20 %')).toBeTruthy();
    expect(screen.getByText(/No se pudo actualizar la ocupación: No se pudo conectar con el servidor/)).toBeTruthy();
  });
});