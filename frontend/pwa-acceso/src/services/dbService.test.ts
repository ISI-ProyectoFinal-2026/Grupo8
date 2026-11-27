// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import type { IJwtPayload } from '../types/security';
import { dbService, MAX_HISTORIAL } from './dbService';

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
    expect(personaDos?.qr_payload.tipo_ingreso).toBe('MANUAL');
    expect(personaDos?.qr_payload.tipo_visita).toBe('Manual con Reserva');
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
describe('dbService — capacidad máxima (Issue 16.5)', () => {
  beforeEach(async () => {
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
  });

  afterEach(async () => {
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
  });

  it('sin capacidad guardada devuelve null y no inventa un valor', async () => {
    expect(await dbService.obtenerCapacidadMaxima()).toBeNull();
  });

  it('guarda y devuelve la capacidad como número', async () => {
    await dbService.guardarCapacidadMaxima(80);

    expect(await dbService.obtenerCapacidadMaxima()).toBe(80);
  });

  it('sin capacidad descargada no se frena el ingreso por cupo', async () => {
    await expect(
      dbService.registrarIngresoManual('30111222', 'Grupo Grande', 999, 'Espontaneo')
    ).resolves.toMatch(/^manual-/);
  });

  it('con capacidad conocida, un grupo que no entra se rechaza', async () => {
    await dbService.guardarCapacidadMaxima(10);

    await expect(
      dbService.registrarIngresoManual('30111222', 'Grupo Grande', 10, 'Espontaneo') // 11 personas
    ).rejects.toThrow('CAPACIDAD_EXCEDIDA');
    expect(await db.ingresos_pendientes.count()).toBe(0);
  });
});
describe('dbService — Historial del dispositivo (26.2)', () => {
  const qr = (personas = 2) => ({
    reserva_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    cantidad_personas: personas,
    typ: 'socio',
  });

  beforeEach(async () => {
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
    await db.historial.clear();
  });

  afterEach(async () => {
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
    await db.historial.clear();
  });

  it('un QR aceptado entra al historial como pendiente, con el mismo jti y el id de reserva como texto', async () => {
    await dbService.registrarIngresoOffline('qr-1', qr(3));

    const [fila] = await db.historial.toArray();
    expect(fila).toMatchObject({
      jti: 'qr-1',
      tipo: 'QR',
      reserva_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      cantidad_personas: 3,
      estado: 'pendiente',
    });
    const [pendiente] = await db.ingresos_pendientes.toArray();
    expect(fila.fecha_ingreso.getTime()).toBe(pendiente.fecha_escaneo.getTime());
  });

  it('un ingreso manual entra como "MANUAL", sin reserva y sin los datos del visitante', async () => {
    const idLocal = await dbService.registrarIngresoManual('30111222', 'Juan Perez', 1, 'Espontaneo', 1500);
    // Devuelve el jti: es el "ID local" que muestra la confirmación (26.4)
    expect((await db.historial.toArray())[0].jti).toBe(idLocal);

    const [fila] = await db.historial.toArray();
    expect(fila).toMatchObject({ tipo: 'MANUAL', reserva_id: null, cantidad_personas: 2, estado: 'pendiente' });
    expect(JSON.stringify(fila)).not.toContain('30111222');
    expect(JSON.stringify(fila)).not.toContain('Juan Perez');
  });

  it('un ingreso rechazado (QR duplicado) no deja fila en el historial', async () => {
    await dbService.registrarIngresoOffline('qr-1', qr());
    await expect(dbService.registrarIngresoOffline('qr-1', qr())).rejects.toThrow('QR_DUPLICADO');

    expect(await db.historial.count()).toBe(1);
  });

  it(`con ${MAX_HISTORIAL + 1} ingresos borra el más viejo del historial, pero la cola conserva los ${MAX_HISTORIAL + 1}`, async () => {
    for (let i = 1; i <= MAX_HISTORIAL + 1; i++) {
      await dbService.registrarIngresoOffline(`qr-${i}`, qr(1));
    }

    const historial = await db.historial.toArray();
    expect(historial).toHaveLength(MAX_HISTORIAL);
    expect(historial.some((fila) => fila.jti === 'qr-1')).toBe(false);
    expect(historial.some((fila) => fila.jti === `qr-${MAX_HISTORIAL + 1}`)).toBe(true);

    // El recorte es solo visual: el ingreso más viejo sigue esperando para enviarse
    const cola = await dbService.obtenerPendientesSincronizacion();
    expect(cola).toHaveLength(MAX_HISTORIAL + 1);
    expect(cola[0].jti).toBe('qr-1');
  });

  it('marcarComoSincronizados saca de la cola solo los confirmados y los marca en el historial', async () => {
    await dbService.registrarIngresoOffline('qr-1', qr());
    await dbService.registrarIngresoOffline('qr-2', qr());

    await dbService.marcarComoSincronizados(['qr-1']);

    const estados = Object.fromEntries((await db.historial.toArray()).map((f) => [f.jti, f.estado]));
    expect(estados).toEqual({ 'qr-1': 'sincronizado', 'qr-2': 'pendiente' });
    expect((await db.ingresos_pendientes.toArray()).map((p) => p.jti)).toEqual(['qr-2']);
  });

  it('obtenerHistorial devuelve del más nuevo al más viejo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    await dbService.registrarIngresoOffline('qr-viejo', qr());
    vi.setSystemTime(new Date('2026-11-16T11:00:00Z'));
    await dbService.registrarIngresoOffline('qr-nuevo', qr());
    vi.useRealTimers();

    expect((await dbService.obtenerHistorial()).map((f) => f.jti)).toEqual(['qr-nuevo', 'qr-viejo']);
  });
});

describe('dbService — Registro manual con reserva (29.1)', () => {
  const RESERVA_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const qrReserva = (cambios: Partial<IJwtPayload> = {}): IJwtPayload => ({
    jti: 'qr-reserva-1',
    reserva_id: RESERVA_ID,
    camping_id: 'CAMP-01',
    iat: 1,
    exp: 9999999999,
    cantidad_personas: 3,
    typ: 'visitante',
    dat: '2026-12-01',
    ...cambios,
  });

  const limpiar = async () => {
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.configuracion.clear();
  };

  beforeEach(limpiar);
  afterEach(limpiar);

  it('queda vinculado a la reserva, con el jti y la cantidad de personas del QR', async () => {
    const idLocal = await dbService.registrarIngresoManualConReserva(
      '30111222',
      'Juan Perez',
      qrReserva(),
      0
    );

    expect(idLocal).toBe('qr-reserva-1');
    const [pendiente] = await db.ingresos_pendientes.toArray();
    expect(pendiente.jti).toBe('qr-reserva-1');
    expect(pendiente.qr_payload).toMatchObject({
      tipo_ingreso: 'MANUAL',
      reserva_id: RESERVA_ID,
      dni: '30111222',
      nombre: 'Juan Perez',
      cantidad_personas: 3,
    });
    const [fila] = await db.historial.toArray();
    expect(fila).toMatchObject({
      tipo: 'MANUAL',
      reserva_id: RESERVA_ID,
      cantidad_personas: 3,
    });
  });

  it('la misma reserva no ingresa dos veces, ni con otro QR', async () => {
    await dbService.registrarIngresoManualConReserva(
      '30111222',
      'Juan Perez',
      qrReserva(),
      0
    );

    await expect(
      dbService.registrarIngresoManualConReserva(
        '30111222',
        'Juan Perez',
        qrReserva(),
        0
      )
    ).rejects.toThrow('RESERVA_YA_INGRESADA');
    await expect(
      dbService.registrarIngresoManualConReserva(
        '30111222',
        'Juan Perez',
        qrReserva({ jti: 'qr-otro' }),
        0
      )
    ).rejects.toThrow('RESERVA_YA_INGRESADA');
    expect(await db.ingresos_pendientes.count()).toBe(1);
  });

  it('un QR ya escaneado también cuenta como reserva ya ingresada', async () => {
    await dbService.registrarIngresoOffline('qr-reserva-1', qrReserva());

    await expect(
      dbService.registrarIngresoManualConReserva(
        '30111222',
        'Juan Perez',
        qrReserva(),
        0
      )
    ).rejects.toThrow('RESERVA_YA_INGRESADA');
  });

  it('una reserva ya sincronizada (fuera de la cola) sigue figurando como ingresada por el historial', async () => {
    await dbService.registrarIngresoManualConReserva(
      '30111222',
      'Juan Perez',
      qrReserva(),
      0
    );
    await dbService.marcarComoSincronizados(['qr-reserva-1']);

    expect(await db.ingresos_pendientes.count()).toBe(0);
    expect(await dbService.reservaYaIngreso(RESERVA_ID)).toBe(true);
  });

  it('reservaYaIngreso es falso para una reserva que no ingresó', async () => {
    expect(await dbService.reservaYaIngreso(RESERVA_ID)).toBe(false);
  });

  it('respeta el cupo del camping', async () => {
    await dbService.guardarCapacidadMaxima(2);

    await expect(
      dbService.registrarIngresoManualConReserva(
        '30111222',
        'Juan Perez',
        qrReserva({ cantidad_personas: 3 }),
        0
      )
    ).rejects.toThrow('CAPACIDAD_EXCEDIDA');
    expect(await db.ingresos_pendientes.count()).toBe(0);
  });
});
