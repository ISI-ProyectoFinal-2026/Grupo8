// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hoyEnArgentina } from '@/lib/cobros';
import {
  IngresosApiError,
  obtenerHistorialIngresos,
  type IngresoAdmin,
  type IngresosPaginados,
} from '@/services/ingresosAdminService';
import HistorialIngresos, { AVISO_SINCRONIZACION } from './HistorialIngresos';

vi.mock('@/context/AuthContext', () => ({
  AUTH_EXPIRED_EVENT: 'auth:expired',
  useAuth: () => ({ token: 'token-admin' }),
}));

// Se simula el pedido; las clases y los mensajes son los reales
vi.mock('@/services/ingresosAdminService', async (original) => ({
  ...(await original<typeof import('@/services/ingresosAdminService')>()),
  obtenerHistorialIngresos: vi.fn(),
}));

const ingreso = (cambios: Partial<IngresoAdmin> = {}): IngresoAdmin => ({
  id: crypto.randomUUID(),
  // 03:30 UTC son las 00:30 en Buenos Aires
  fecha_hora_ingreso: '2026-11-17T03:30:00Z',
  reserva_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  personas: 3,
  tipo_cliente: 'socio',
  tipo_ingreso: 'web',
  ...cambios,
});

const respuesta = (
  items: IngresoAdmin[],
  extra: Partial<IngresosPaginados> = {}
): IngresosPaginados => ({
  desde: '2026-11-17',
  hasta: '2026-11-17',
  total: items.length,
  items,
  ...extra,
});

describe('Historial de ingresos del panel (26.6)', () => {
  beforeEach(() => {
    vi.mocked(obtenerHistorialIngresos).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('sin tocar nada pide los ingresos de hoy (Buenos Aires), página 1', async () => {
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(respuesta([]));

    render(<HistorialIngresos />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Historial de ingresos' })
    ).toBeTruthy();
    const hoy = hoyEnArgentina();
    expect(vi.mocked(obtenerHistorialIngresos).mock.calls[0][1]).toMatchObject({
      desde: hoy,
      hasta: hoy,
      pagina: 0,
    });
    await screen.findByText(/No hubo ingresos el/);
  });

  it('aclara que los ingresos sin conexión llegan cuando el dispositivo se sincroniza', () => {
    vi.mocked(obtenerHistorialIngresos).mockReturnValue(new Promise(() => {}));

    render(<HistorialIngresos />);

    expect(screen.getByText(AVISO_SINCRONIZACION)).toBeTruthy();
    expect(AVISO_SINCRONIZACION).toBe(
      'Los ingresos registrados sin conexión aparecen cuando el dispositivo se sincroniza.'
    );
  });

  it('muestra "cargando" mientras espera la respuesta', () => {
    vi.mocked(obtenerHistorialIngresos).mockReturnValue(new Promise(() => {}));

    render(<HistorialIngresos />);

    expect(screen.getByRole('status').textContent).toBe('Cargando ingresos…');
  });

  it('sin ingresos lo dice con la fecha consultada', async () => {
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(respuesta([]));

    render(<HistorialIngresos />);

    expect((await screen.findByRole('status')).textContent).toBe(
      'No hubo ingresos el 17/11/2026.'
    );
  });

  it('cada fila tiene hora (en Buenos Aires), reserva o "Manual", pax, cliente y tipo de ingreso', async () => {
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(
      respuesta([
        ingreso(),
        ingreso({
          fecha_hora_ingreso: '2026-11-17T02:59:00Z',
          reserva_id: null,
          personas: 1,
          tipo_cliente: 'visitante',
          tipo_ingreso: 'manual',
        }),
      ])
    );

    render(<HistorialIngresos />);

    const tabla = await screen.findByRole('table');
    const [, qr, manual] = within(tabla).getAllByRole('row');
    expect(
      within(qr)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['#7c9e6679', '3', 'Socio', 'Web']);
    expect(within(qr).getByRole('rowheader').textContent).toBe('00:30');
    expect(qr.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-11-17T03:30:00Z'
    );

    // 02:59 UTC del 17 son las 23:59 del 16 en Buenos Aires
    expect(within(manual).getByRole('rowheader').textContent).toBe('23:59');
    expect(
      within(manual)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['Manual', '1', 'Visitante', 'Manual']);

    // No hay columna de estado de sincronización: el servidor solo conoce lo que ya llegó
    expect(within(tabla).queryByText(/sincroniz|pendiente/i)).toBeNull();
  });

  it('con un rango de varios días muestra la fecha junto a la hora', async () => {
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(
      respuesta([ingreso()], { desde: '2026-11-10', hasta: '2026-11-17' })
    );

    render(<HistorialIngresos />);

    expect((await screen.findByRole('rowheader')).textContent).toMatch(
      /17\/11\/26.*00:30/
    );
  });

  it('si falla, muestra el error y "Reintentar" vuelve a pedir', async () => {
    vi.mocked(obtenerHistorialIngresos)
      .mockRejectedValueOnce(new IngresosApiError(403, 'Forbidden'))
      .mockResolvedValueOnce(respuesta([ingreso()]));

    render(<HistorialIngresos />);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No se pudo consultar el historial. No tenés permisos para ver el historial de ingresos.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(obtenerHistorialIngresos).toHaveBeenCalledTimes(2);
  });

  it('"Consultar" pide el rango elegido desde la página 1', async () => {
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(respuesta([]));
    render(<HistorialIngresos />);
    await screen.findByText(/No hubo ingresos/);

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-11-10' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-11-16' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    });

    expect(
      vi.mocked(obtenerHistorialIngresos).mock.calls.at(-1)?.[1]
    ).toMatchObject({
      desde: '2026-11-10',
      hasta: '2026-11-16',
      pagina: 0,
    });
  });

  it('con "desde" posterior a "hasta" avisa y no consulta', async () => {
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(respuesta([]));
    render(<HistorialIngresos />);
    await screen.findByText(/No hubo ingresos/);

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-11-17' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-11-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));

    expect(screen.getByRole('alert').textContent).toBe(
      'La fecha "desde" no puede ser posterior a "hasta".'
    );
    expect(obtenerHistorialIngresos).toHaveBeenCalledTimes(1);
  });

  it('pagina con "Siguiente" y "Anterior"', async () => {
    const pagina = Array.from({ length: 20 }, () => ingreso());
    vi.mocked(obtenerHistorialIngresos).mockResolvedValue(
      respuesta(pagina, { total: 45 })
    );
    render(<HistorialIngresos />);

    const nav = await screen.findByRole('navigation', {
      name: 'Paginación del historial de ingresos',
    });
    expect(within(nav).getByText('Mostrando 1–20 de 45')).toBeTruthy();
    expect(within(nav).getByText('Página 1 de 3')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(nav).getByRole('button', { name: 'Siguiente' }));
    });

    expect(
      vi.mocked(obtenerHistorialIngresos).mock.calls.at(-1)?.[1]
    ).toMatchObject({ pagina: 1 });
  });
});
