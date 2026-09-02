// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { dbService } from './dbService';
import { syncService } from './syncService';

/**
 * Issue 8.4 — Comportamiento Offline/Online (integration tests).
 *
 * Reutiliza el flujo real del proyecto:
 * - Registro local: dbService.registrarIngresoManual (nunca toca la red).
 * - Envío/sincronización: syncService.sincronizarIngresosPendientes.
 * - Trigger de reconexión: el evento 'online' registrado por
 *   syncService.iniciarBackgroundSync (el mismo que usa App.tsx).
 * - Almacenamiento: Dexie sobre fake-indexeddb (misma estrategia que 8.3).
 *
 * Nota de arquitectura importante: en este proyecto el registro de un
 * ingreso NUNCA hace fetch (offline-first real: siempre escribe primero
 * en IndexedDB). Por eso "pérdida de conexión durante un ingreso" se
 * verifica en dos partes: (a) el registro funciona igual estando offline,
 * y (b) si en ese momento se dispara un intento real de sincronización
 * y la red falla, el registro no se pierde ni la app explota.
 */
describe('Offline/Online integration — pérdida y recuperación de conexión (Issue 8.4)', () => {
  let originalOnLineDescriptor: PropertyDescriptor | undefined;

  function setNavigatorOnLine(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value,
    });
  }

  beforeAll(() => {
    originalOnLineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

    // Se registra UNA sola vez para todo el archivo: iniciarBackgroundSync
    // no expone forma de remover el listener 'online' ni el setInterval
    // que crea (no guarda referencias, no devuelve ids). Llamarla en cada
    // test acumularía listeners duplicados y dispararía múltiples
    // sincronizaciones por cada evento 'online' disparado.
    syncService.iniciarBackgroundSync();
  });

  afterAll(() => {
    if (originalOnLineDescriptor) {
      Object.defineProperty(window.navigator, 'onLine', originalOnLineDescriptor);
    }
  });

  beforeEach(async () => {
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
    setNavigatorOnLine(true);
    syncService.isSyncing = false;

    // Mock de fetch por defecto: éxito "vacío". Actúa como red de
    // seguridad: si un reintento con backoff agendado por un test anterior
    // (setTimeout real, no controlado por fake timers) llegara a
    // dispararse durante otro test, pega contra un mock inocuo en vez de
    // corromper las aserciones del test en curso.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sincronizados: [], errores: [] }),
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
    setNavigatorOnLine(true);
    syncService.isSyncing = false;
    vi.restoreAllMocks();
  });

  it('Test 3 — pérdida de conexión durante un ingreso: se registra en ingresos_pendientes y la falla de red no rompe la app', async () => {
    // 1. Estado inicial online
    setNavigatorOnLine(true);

    // 2. Pérdida de conexión (el proyecto no escucha 'offline' hoy, pero
    // se simula igual por completitud del escenario descripto).
    setNavigatorOnLine(false);
    window.dispatchEvent(new Event('offline'));

    // 3. Registrar un ingreso con el flujo REAL de la app. Funciona igual
    // estando offline porque nunca toca la red (ver nota de arquitectura).
    await dbService.registrarIngresoManual('40123456', 'Visitante Offline', 0, 'Espontaneo');

    const pendientesAntes = await db.ingresos_pendientes.toArray();
    expect(pendientesAntes).toHaveLength(1);

    // 4-5. Mientras la conexión sigue caída, se intenta sincronizar
    // (flujo real de syncService) y la petición falla con un error de red.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );

    // El error debe ser interceptado por el manejo existente: la promesa
    // no debe rechazar hacia afuera (no produce excepción no controlada).
    await expect(syncService.sincronizarIngresosPendientes()).resolves.toBeUndefined();

    // 6-7. El ingreso sigue en ingresos_pendientes con su estructura real.
    const pendientesDespues = await db.ingresos_pendientes.toArray();
    expect(pendientesDespues).toHaveLength(1);

    const registro = pendientesDespues[0];
    expect(registro.qr_payload.dni).toBe('40123456');
    expect(registro.fecha_escaneo).toBeInstanceOf(Date);
    expect(registro.sincronizado).toBe(false);
  });

  it('Test 4 — recuperación de conexión: el evento "online" dispara syncService y la cola queda vacía (respetando FIFO)', async () => {
    // 1. Preparamos ingresos pendientes con timestamps distintos, offline.
    setNavigatorOnLine(false);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
    await dbService.registrarIngresoManual('10000000', 'Ingreso A', 0, 'Espontaneo'); // A

    vi.setSystemTime(new Date('2026-01-01T10:05:00.000Z'));
    await dbService.registrarIngresoManual('20000000', 'Ingreso B', 0, 'Espontaneo'); // B

    vi.setSystemTime(new Date('2026-01-01T10:02:00.000Z'));
    await dbService.registrarIngresoManual('30000000', 'Ingreso C', 0, 'Espontaneo'); // C
    vi.useRealTimers();

    // 3. Confirmamos que existen registros pendientes antes de sincronizar.
    const pendientesAntes = await db.ingresos_pendientes.toArray();
    expect(pendientesAntes).toHaveLength(3);

    // Mock de fetch exitoso que refleja los jti realmente recibidos en el
    // body armado por syncService (integración real, no un mock ciego).
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as { ingresos: Array<{ jti: string }> };
      const jtisRecibidos = body.ingresos.map((i) => i.jti);
      return {
        ok: true,
        json: async () => ({ sincronizados: jtisRecibidos, errores: [] }),
      };
    }) as unknown as typeof fetch;

    // 4. Se restaura la conexión.
    setNavigatorOnLine(true);

    // 5. Disparamos el MISMO trigger real que usa la app: el evento
    // 'online', escuchado por syncService.iniciarBackgroundSync (ya
    // registrado en beforeAll).
    window.dispatchEvent(new Event('online'));

    // 6-7. Esperamos a que el envío real se complete (el listener no es
    // awaited por dispatchEvent, así que se polea con vi.waitFor).
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const bodyEnviado = JSON.parse(
      fetchMock.mock.calls[0][1].body as string
    ) as { ingresos: Array<{ jti: string }> };
    const ordenEnviado = bodyEnviado.ingresos.map((i) => i.jti);

    // Orden FIFO real (A 10:00 -> C 10:02 -> B 10:05), heredado de la
    // corrección de dbService.obtenerPendientesSincronizacion (Issue 8.3).
    expect(ordenEnviado[0]).toContain('10000000'); // A
    expect(ordenEnviado[1]).toContain('30000000'); // C
    expect(ordenEnviado[2]).toContain('20000000'); // B

    // 8. Tras una sincronización exitosa, la cola local queda vacía.
    await vi.waitFor(async () => {
      const pendientesDespues = await db.ingresos_pendientes.toArray();
      expect(pendientesDespues).toHaveLength(0);
    });
  });

  it('Test 5 — fallo durante la sincronización: los ingresos pendientes existentes no se pierden', async () => {
    // Ingresos ya en cola (simulando que quedaron de una caída anterior).
    await dbService.registrarIngresoManual('50000000', 'Ingreso Pendiente 1', 0, 'Espontaneo');
    await dbService.registrarIngresoManual('60000000', 'Ingreso Pendiente 2', 1, 'Espontaneo');

    const pendientesAntes = await db.ingresos_pendientes.toArray();
    expect(pendientesAntes).toHaveLength(2);

    // Se recupera la conexión, pero la petición de sincronización falla.
    setNavigatorOnLine(true);
    globalThis.fetch = vi.fn().mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    ) as unknown as typeof fetch;

    await expect(syncService.sincronizarIngresosPendientes()).resolves.toBeUndefined();

    // Los registros se conservan intactos y sin marcar como sincronizados,
    // disponibles para el mecanismo de reintentos YA EXISTENTE (no se
    // agrega ningún retry nuevo, solo se prueba el actual).
    const pendientesDespues = await db.ingresos_pendientes.toArray();
    expect(pendientesDespues).toHaveLength(2);
    expect(pendientesDespues.every((p) => p.sincronizado === false)).toBe(true);

    const dnis = pendientesDespues.map((p) => p.qr_payload.dni);
    expect(dnis).toEqual(expect.arrayContaining(['50000000', '60000000']));
  });
});