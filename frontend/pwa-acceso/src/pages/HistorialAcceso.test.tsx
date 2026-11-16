// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { dbService, MAX_HISTORIAL } from '@/services/dbService';
import HistorialAcceso from './HistorialAcceso';

const RESERVA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

async function cargarDosIngresos() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T10:00:00'));
  await dbService.registrarIngresoOffline('qr-1', {
    reserva_id: RESERVA,
    cantidad_personas: 3,
  });
  vi.setSystemTime(new Date('2026-11-16T11:30:00'));
  await dbService.registrarIngresoManual(
    '30111222',
    'Juan Perez',
    0,
    'Espontaneo'
  );
  vi.useRealTimers();
}

describe('Historial de la app del guardia (26.2)', () => {
  beforeEach(async () => {
    await db.historial.clear();
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    await db.historial.clear();
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
  });

  it('sin ingresos muestra el aviso vacío y cuántos guarda', async () => {
    render(<HistorialAcceso />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Historial' })
    ).toBeTruthy();
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Todavía no hay ingresos',
      })
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Últimos ${MAX_HISTORIAL} ingresos registrados en este dispositivo`
      )
    ).toBeTruthy();
  });

  it('muestra reserva o "Ingreso manual", fecha y hora, personas y estado, del más nuevo al más viejo', async () => {
    await cargarDosIngresos();
    render(<HistorialAcceso />);

    const lista = await screen.findByRole('list', { name: 'Últimos ingresos' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(2);

    expect(within(filas[0]).getByText('Ingreso manual')).toBeTruthy();
    expect(within(filas[0]).getByText(/1 persona$/)).toBeTruthy();
    expect(filas[0].querySelector('time')?.textContent).toMatch(
      /16\/11\/26.*11:30/
    );

    expect(within(filas[1]).getByText('Reserva #7c9e6679')).toBeTruthy();
    expect(within(filas[1]).getByText(/3 personas$/)).toBeTruthy();
    expect(filas[1].querySelector('time')?.textContent).toMatch(/10:00/);

    // El estado va con texto, no solo con color
    expect(within(filas[0]).getByText('Pendiente')).toBeTruthy();
    expect(within(filas[1]).getByText('Pendiente')).toBeTruthy();
  });

  it('cuando el servidor confirma un ingreso, la fila pasa a "Sincronizado" sin recargar', async () => {
    await cargarDosIngresos();
    render(<HistorialAcceso />);
    const lista = await screen.findByRole('list', { name: 'Últimos ingresos' });

    await act(async () => {
      await dbService.marcarComoSincronizados(['qr-1']);
    });

    const filaReserva = (
      await within(lista).findByText('Sincronizado')
    ).closest('li') as HTMLElement;
    expect(within(filaReserva).getByText('Reserva #7c9e6679')).toBeTruthy();
    expect(within(lista).getAllByText('Pendiente')).toHaveLength(1);
  });

  it('si IndexedDB no responde, lo avisa en vez de romper la pantalla', async () => {
    vi.spyOn(dbService, 'obtenerHistorial').mockRejectedValue(
      new Error('sin IndexedDB')
    );
    render(<HistorialAcceso />);

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /No se pudo leer el historial/
    );
  });
});
