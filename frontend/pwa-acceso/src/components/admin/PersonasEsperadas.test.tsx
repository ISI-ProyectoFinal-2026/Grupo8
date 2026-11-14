// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonasEsperadas } from './PersonasEsperadas';
import { INTERVALO_ACTUALIZACION_MS } from '@/hooks/useOcupacion';
import { obtenerEsperados, OcupacionApiError } from '@/services/ocupacionService';

// Se reemplaza solo la llamada a la red; la clase de error y mensajeDeError son los reales
vi.mock('@/services/ocupacionService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/ocupacionService')>();
  return { ...original, obtenerEsperados: vi.fn() };
});
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'token-de-prueba' }),
  AUTH_EXPIRED_EVENT: 'qamp:auth-expired',
}));

describe('Personas esperadas en el inicio del panel', () => {
  beforeEach(() => {
    vi.mocked(obtenerEsperados).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('muestra "cargando" mientras espera la respuesta', () => {
    vi.mocked(obtenerEsperados).mockReturnValue(new Promise(() => {}));

    render(<PersonasEsperadas />);

    expect(screen.getByText('Cargando personas esperadas…')).toBeTruthy();
  });

  it('muestra cuántas personas y reservas se esperan', async () => {
    vi.mocked(obtenerEsperados).mockResolvedValue({ reservas: 9, personas: 34 });

    render(<PersonasEsperadas />);

    expect(await screen.findByText('Se esperan 34 personas de 9 reservas')).toBeTruthy();
    expect(vi.mocked(obtenerEsperados).mock.calls[0][0]).toBe('token-de-prueba');
  });

  it('aclara que no se suman a la ocupación actual', async () => {
    vi.mocked(obtenerEsperados).mockResolvedValue({ reservas: 1, personas: 2 });

    render(<PersonasEsperadas />);

    expect(await screen.findByText(/no se suman a la ocupación actual/i)).toBeTruthy();
  });

  it('sin reservas esperadas lo dice', async () => {
    vi.mocked(obtenerEsperados).mockResolvedValue({ reservas: 0, personas: 0 });

    render(<PersonasEsperadas />);

    expect(await screen.findByText('No se esperan más ingresos por reservas web hoy.')).toBeTruthy();
  });

  it('muestra el error y permite reintentar', async () => {
    vi.mocked(obtenerEsperados)
      .mockRejectedValueOnce(new OcupacionApiError(500, 'Error interno'))
      .mockResolvedValueOnce({ reservas: 2, personas: 5 });

    render(<PersonasEsperadas />);

    expect(
      await screen.findByText(/No se pudo consultar las personas esperadas. Error interno/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Se esperan 5 personas de 2 reservas')).toBeTruthy();
  });

  it('se actualiza sola: cuando una reserva ingresa deja de contarse', async () => {
    vi.useFakeTimers();
    vi.mocked(obtenerEsperados)
      .mockResolvedValueOnce({ reservas: 2, personas: 5 })
      .mockResolvedValueOnce({ reservas: 1, personas: 2 });

    render(<PersonasEsperadas />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Se esperan 5 personas de 2 reservas')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ACTUALIZACION_MS);
    });

    expect(obtenerEsperados).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Se esperan 2 personas de 1 reserva')).toBeTruthy();
  });

  it('si falla una actualización, sigue mostrando los últimos datos', async () => {
    vi.useFakeTimers();
    vi.mocked(obtenerEsperados)
      .mockResolvedValueOnce({ reservas: 2, personas: 5 })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<PersonasEsperadas />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ACTUALIZACION_MS);
    });

    expect(screen.getByText('Se esperan 5 personas de 2 reservas')).toBeTruthy();
    expect(screen.getByText(/No se pudo actualizar: No se pudo conectar con el servidor/)).toBeTruthy();
  });

  it('una sesión vencida avisa a la app para cerrarla', async () => {
    const escucha = vi.fn();
    window.addEventListener('qamp:auth-expired', escucha);
    vi.mocked(obtenerEsperados).mockRejectedValue(new OcupacionApiError(401, 'No autenticado'));

    render(<PersonasEsperadas />);

    expect(await screen.findByText(/Tu sesión venció/)).toBeTruthy();
    expect(escucha).toHaveBeenCalled();
    window.removeEventListener('qamp:auth-expired', escucha);
  });
});
