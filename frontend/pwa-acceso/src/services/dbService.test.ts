// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { dbService } from './dbService';

/* Encolamiento de ingresos en IndexedDB (store `ingresos_pendientes`).
 *
 * Aislamiento: SgicOfflineDB es un singleton (db.ts), así que en vez de
 * crear una instancia nueva por test se limpian explícitamente los stores
 * relevantes (`ingresos_pendientes`, `configuracion`) en beforeEach para
 * que ningún test contamine a otro.
 */

describe('dbService — Encolamiento de ingresos en IndexedDB (Issue 8.3)', () => {
  beforeEach(async () => {
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
  });

  it('Test 1 — registrarIngresoManual encola correctamente un registro en ingresos_pendientes', async () => {
    const fechaFija = new Date('2026-01-01T10:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(fechaFija);

    await dbService.registrarIngresoManual('30111222', 'Juan Perez', 1, 'Espontaneo');

    vi.useRealTimers();

    const registros = await db.ingresos_pendientes.toArray();
    expect(registros).toHaveLength(1);

    const registro = registros[0];

    // DNI: en la estructura actual, el DNI de un ingreso manual vive
    // dentro de qr_payload.dni (ver dbService.registrarIngresoManual).
    expect(registro.qr_payload.dni).toBe('30111222');

    // Timestamp
    expect(registro.fecha_escaneo).toBeInstanceOf(Date);
    expect(registro.fecha_escaneo.getTime()).toBe(fechaFija.getTime());

    // Estado de sincronización: el campo real del store local es
    // `sincronizado` (no `sincronizado_offline`, que es un campo homónimo
    // pero de otro modelo, el backend `IngresoFisico`).
    expect(registro.sincronizado).toBe(false);
  });

  it('Test 2 — obtenerPendientesSincronizacion lee correctamente los ingresos insertados', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(new Date('2026-01-01T09:00:00.000Z'));
    await dbService.registrarIngresoManual('11111111', 'Persona Uno', 0, 'Espontaneo');

    vi.setSystemTime(new Date('2026-01-01T09:05:00.000Z'));
    await dbService.registrarIngresoManual('22222222', 'Persona Dos', 2, 'Manual con Reserva');

    vi.useRealTimers();

    const pendientes = await dbService.obtenerPendientesSincronizacion();
    expect(pendientes).toHaveLength(2);

    const dnis = pendientes.map((p) => p.qr_payload.dni);
    expect(dnis).toContain('11111111');
    expect(dnis).toContain('22222222');
    expect(dnis).not.toContain('99999999'); // no trae registros inexistentes

    const personaDos = pendientes.find((p) => p.qr_payload.dni === '22222222');
    expect(personaDos?.qr_payload.cantidad_personas).toBe(3); // 2 acompañantes + 1
    expect(personaDos?.qr_payload.tipo_ingreso).toBe('Manual con Reserva');
  });

  it('Test 3 — orden FIFO: obtenerPendientesSincronizacion devuelve los registros en orden cronológico ascendente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    // Se insertan deliberadamente fuera de orden cronológico:
    // A -> 10:00, B -> 10:05, C -> 10:02
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
    await dbService.registrarIngresoManual('10000000', 'Ingreso A', 0, 'Espontaneo'); // A

    vi.setSystemTime(new Date('2026-01-01T10:05:00.000Z'));
    await dbService.registrarIngresoManual('20000000', 'Ingreso B', 0, 'Espontaneo'); // B

    vi.setSystemTime(new Date('2026-01-01T10:02:00.000Z'));
    await dbService.registrarIngresoManual('30000000', 'Ingreso C', 0, 'Espontaneo'); // C

    vi.useRealTimers();

    const pendientes = await dbService.obtenerPendientesSincronizacion();
    expect(pendientes).toHaveLength(3);

    // Orden esperado: A (10:00) -> C (10:02) -> B (10:05)
    const dnisEnOrden = pendientes.map((p) => p.qr_payload.dni);
    expect(dnisEnOrden).toEqual(['10000000', '30000000', '20000000']);

    // Confirmación explícita: los timestamps quedan en orden ascendente
    const timestamps = pendientes.map((p) => p.fecha_escaneo.getTime());
    const timestampsOrdenados = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(timestampsOrdenados);
  });

  it('Test 4 — estado inicial de la cola: obtenerPendientesSincronizacion devuelve un array vacío sin errores', async () => {
    const pendientes = await dbService.obtenerPendientesSincronizacion();

    expect(pendientes).toEqual([]);
    expect(pendientes).toHaveLength(0);
  });
});