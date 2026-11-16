// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

/**
 * Actualización de la base del dispositivo de la v3 a la v4 (26.2).
 * Se arma una base v3 con datos, como la que tiene hoy un celular en uso, y recién después
 * se carga db.ts para que Dexie aplique la v4 al abrirla.
 */
describe('Migración de IndexedDB v3 → v4 (26.2)', () => {
  it('conserva la cola pendiente y pasa a texto el reserva_id del historial', async () => {
    const viejo = new Dexie('SgicOfflineDB');
    viejo.version(3).stores({
      configuracion: 'clave',
      ingresos_pendientes: '++id, jti, sincronizado',
      historial: '++id, reserva_id, fecha_ingreso',
      blacklist: 'id',
    });
    const fecha = new Date('2026-11-15T12:00:00Z');
    await viejo.table('ingresos_pendientes').bulkAdd([
      {
        jti: 'qr-1',
        qr_payload: { cantidad_personas: 2 },
        fecha_escaneo: fecha,
        sincronizado: false,
      },
      {
        jti: 'manual-1',
        qr_payload: { dni: '30111222', monto_cobrado: 500 },
        fecha_escaneo: fecha,
        sincronizado: false,
      },
    ]);
    await viejo
      .table('configuracion')
      .put({ clave: 'ocupacion_actual', valor: '3' });
    await viejo
      .table('historial')
      .add({ reserva_id: 42, fecha_ingreso: fecha, estado: 'ok' });
    viejo.close();

    const { db } = await import('./db');
    await db.open();

    expect(db.verno).toBe(4);
    const cola = await db.ingresos_pendientes.toArray();
    expect(cola.map((p) => p.jti)).toEqual(['qr-1', 'manual-1']);
    expect(cola[1].qr_payload.monto_cobrado).toBe(500);
    expect((await db.configuracion.get('ocupacion_actual'))?.valor).toBe('3');

    const [fila] = await db.historial.toArray();
    expect(fila.reserva_id).toBe('42');
    // El índice nuevo ya se puede consultar
    expect(await db.historial.where('jti').equals('qr-1').count()).toBe(0);

    db.close();
  });
});
