// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResumenCobros } from './ResumenCobros';
import { formatearMonto } from '@/lib/cotizacion';
import {
  CobrosApiError,
  obtenerResumenCobros,
  type ResumenCobros as Resumen,
} from '@/services/cobrosService';

// Se reemplaza solo la llamada a la red; la clase de error y mensajeDeError son los reales
vi.mock('@/services/cobrosService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/cobrosService')>();
  return { ...original, obtenerResumenCobros: vi.fn() };
});
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'token-de-prueba' }),
  AUTH_EXPIRED_EVENT: 'qamp:auth-expired',
}));

const resumen = (dias: Array<[string, number, number]>): Resumen => {
  const efectivo = dias.reduce((suma, [, e]) => suma + e, 0);
  const mercadoPago = dias.reduce((suma, [, , mp]) => suma + mp, 0);
  return {
    desde: dias[0][0],
    hasta: dias[dias.length - 1][0],
    total_efectivo: efectivo,
    total_mercado_pago: mercadoPago,
    total: efectivo + mercadoPago,
    dias: dias.map(([fecha, e, mp]) => ({ fecha, efectivo: e, mercado_pago: mp, total: e + mp })),
  };
};

const totales = () => within(screen.getByLabelText('Totales del período'));
const tabla = () => screen.getByRole('table', { name: 'Cobros por día' });

describe('Resumen de cobros del panel', () => {
  beforeEach(() => {
    vi.mocked(obtenerResumenCobros).mockReset();
    // Solo se fija la fecha: los timers siguen siendo reales para findBy
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T15:00:00Z'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('muestra "cargando" y pide la última semana al abrir', () => {
    vi.mocked(obtenerResumenCobros).mockReturnValue(new Promise(() => {}));

    render(<ResumenCobros />);

    expect(screen.getByText('Cargando cobros…')).toBeTruthy();
    const [token, desde, hasta] = vi.mocked(obtenerResumenCobros).mock.calls[0];
    expect([token, desde, hasta]).toEqual(['token-de-prueba', '2026-11-02', '2026-11-08']);
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe('2026-11-02');
    expect((screen.getByLabelText('Hasta') as HTMLInputElement).value).toBe('2026-11-08');
  });

  it('muestra los totales por medio de pago y el detalle por día', async () => {
    vi.mocked(obtenerResumenCobros).mockResolvedValue(
      resumen([
        ['2026-11-07', 4500.5, 15000],
        ['2026-11-08', 2000, 0],
      ])
    );

    render(<ResumenCobros />);

    await screen.findByRole('table', { name: 'Cobros por día' });
    expect(totales().getByText(formatearMonto(6500.5))).toBeTruthy();
    expect(totales().getByText(formatearMonto(15000))).toBeTruthy();
    expect(totales().getByText(formatearMonto(21500.5))).toBeTruthy();

    const filas = within(tabla()).getAllByRole('row');
    expect(filas).toHaveLength(3); // encabezado + 2 días
    expect(within(filas[1]).getByText('07/11/2026')).toBeTruthy();
    expect(within(filas[1]).getByText(formatearMonto(19500.5))).toBeTruthy();
    expect(within(filas[2]).getByText('08/11/2026')).toBeTruthy();
  });

  it('muestra el estado vacío si no hubo cobros', async () => {
    vi.mocked(obtenerResumenCobros).mockResolvedValue(
      resumen([
        ['2026-11-07', 0, 0],
        ['2026-11-08', 0, 0],
      ])
    );

    render(<ResumenCobros />);

    expect(await screen.findByText('No hubo cobros entre el 07/11/2026 y 08/11/2026.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('muestra el error y permite reintentar', async () => {
    vi.mocked(obtenerResumenCobros)
      .mockRejectedValueOnce(new CobrosApiError(500, 'Error interno'))
      .mockResolvedValueOnce(resumen([['2026-11-08', 1000, 0]]));

    render(<ResumenCobros />);

    expect(await screen.findByText(/No se pudo consultar los cobros. Error interno/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await screen.findByRole('table', { name: 'Cobros por día' });
    expect(obtenerResumenCobros).toHaveBeenCalledTimes(2);
  });

  it('consulta el rango que elige el administrador', async () => {
    vi.mocked(obtenerResumenCobros)
      .mockResolvedValueOnce(resumen([['2026-11-08', 1000, 0]]))
      .mockResolvedValueOnce(resumen([['2026-10-01', 0, 5000]]));
    render(<ResumenCobros />);
    await screen.findByRole('table', { name: 'Cobros por día' });

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText('01/10/2026')).toBeTruthy();
    const [, desde, hasta] = vi.mocked(obtenerResumenCobros).mock.calls[1];
    expect([desde, hasta]).toEqual(['2026-10-01', '2026-10-01']);
  });

  it.each([
    ['2026-11-09', '2026-11-08', /posterior/],
    ['2026-01-01', '2026-11-08', /92 días/],
  ])('con desde %s y hasta %s no consulta y avisa', async (desde, hasta, mensaje) => {
    vi.mocked(obtenerResumenCobros).mockResolvedValue(resumen([['2026-11-08', 1000, 0]]));
    render(<ResumenCobros />);
    await screen.findByRole('table', { name: 'Cobros por día' });

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: desde } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: hasta } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(await screen.findByText(mensaje)).toBeTruthy();
    expect(obtenerResumenCobros).toHaveBeenCalledTimes(1);
  });
});
