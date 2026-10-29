// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT, TOKEN_KEY } from '@/context/AuthContext';
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
const TOKEN_GUARDIA = 'token-del-guardia';

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
    // bulk-sync exige la sesión del guardia: se simula una abierta
    localStorage.setItem(TOKEN_KEY, TOKEN_GUARDIA);

    // Mock de fetch por defecto: éxito "vacío". Actúa como red de
    // seguridad: si un reintento con backoff agendado por un test anterior
    // (setTimeout real, no controlado por fake timers) llegara a
    // dispararse durante otro test, pega contra un mock inocuo en vez de
    // corromper las aserciones del test en curso.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sincronizados_jti: [], errores: [] }),
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.ingresos_pendientes.clear();
    await db.configuracion.clear();
    setNavigatorOnLine(true);
    syncService.isSyncing = false;
    localStorage.removeItem(TOKEN_KEY);
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
        json: async () => ({ sincronizados_jti: jtisRecibidos, errores: [] }),
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
    ) as { ingresos: Array<{ dni: string }> };
    const ordenEnviado = bodyEnviado.ingresos.map((i) => i.dni);

    // Orden FIFO real (A 10:00 -> C 10:02 -> B 10:05), heredado de la
    // corrección de dbService.obtenerPendientesSincronizacion (Issue 8.3).
    expect(ordenEnviado).toEqual(['10000000', '30000000', '20000000']); // A -> C -> B

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

  it('Test 6 — el manual viaja con tipo_ingreso MANUAL, personas, monto, nombre y dni', async () => {
  await dbService.registrarIngresoManual('40123456', 'Visitante Efectivo', 2, 'Espontaneo', 4500.5);

  await syncService.sincronizarIngresosPendientes();

  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const { ingresos } = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(ingresos[0]).toMatchObject({
    tipo_ingreso: 'MANUAL',
    cantidad_personas: 3,
    monto_cobrado: 4500.5,
    nombre: 'Visitante Efectivo',
    dni: '40123456',
  });
  expect(ingresos[0].jti).toMatch(/^manual-[0-9a-f-]{36}$/);
  });

 it('Test 7 — éxito parcial: solo se borran de la cola los confirmados por el servidor', async () => {
    await dbService.registrarIngresoManual('11111111', 'Uno', 0, 'Espontaneo', 100);
    await dbService.registrarIngresoManual('22222222', 'Dos', 0, 'Espontaneo', 100);

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const { ingresos } = JSON.parse(options.body as string) as { ingresos: Array<{ jti: string }> };
      return {
        ok: true,
        json: async () => ({
          procesados: 1,
          conflictos: 0,
          sincronizados_jti: [ingresos[0].jti],
          errores: [{ indice: 1, jti: ingresos[1].jti, motivo: 'dni: inválido' }],
        }),
      };
    }) as unknown as typeof fetch;

    await syncService.sincronizarIngresosPendientes();

    const restantes = await db.ingresos_pendientes.toArray();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].qr_payload.dni).toBe('22222222');
  });

  it('Test 8 — un reintento reenvía el mismo jti (no se genera uno nuevo)', async () => {
    await dbService.registrarIngresoManual('33333333', 'Reintento', 0, 'Espontaneo', 50);

    globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await syncService.sincronizarIngresosPendientes();
    const jtiPrimerEnvio = (await db.ingresos_pendientes.toArray())[0].jti;

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ procesados: 0, conflictos: 0, sincronizados_jti: [], errores: [] }),
    }) as unknown as typeof fetch;
    await syncService.sincronizarIngresosPendientes();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { ingresos } = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(ingresos[0].jti).toBe(jtiPrimerEnvio);
  });


  it('Test 9 — todos los ingresos viajan con el mismo dispositivo_id', async () => {
    await dbService.registrarIngresoManual('11111111', 'Uno', 0, 'Espontaneo', 10);
    await dbService.registrarIngresoManual('22222222', 'Dos', 0, 'Espontaneo', 10);

    await syncService.sincronizarIngresosPendientes();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { ingresos } = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(ingresos[0].dispositivo_id).toMatch(/^dispositivo-[0-9a-f-]{36}$/);
    expect(ingresos[1].dispositivo_id).toBe(ingresos[0].dispositivo_id);
  });
  // ---------- Autenticación de bulk-sync (Issue 13.5) ----------

  function responder(status: number) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  }

  it('Test 10 — bulk-sync viaja con el token del guardia en el header Authorization', async () => {
    await dbService.registrarIngresoManual('11111111', 'Con Token', 0, 'Espontaneo', 10);

    await syncService.sincronizarIngresosPendientes();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN_GUARDIA}`);
  });

  it('Test 11 — sin sesión no se envía nada y la cola queda intacta', async () => {
    localStorage.removeItem(TOKEN_KEY);
    await dbService.registrarIngresoManual('22222222', 'Sin Sesion', 0, 'Espontaneo', 10);

    await syncService.sincronizarIngresosPendientes();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await db.ingresos_pendientes.toArray()).toHaveLength(1);
    expect(syncService.isSyncing).toBe(false);
  });

  it('Test 12 — un 401 pausa la sincronización: conserva la cola, no reintenta y cierra la sesión', async () => {
    await dbService.registrarIngresoManual('33333333', 'Token Vencido', 0, 'Espontaneo', 10);
    const fetchMock = responder(401);
    const sesionVencida = vi.fn();
    const avisos: string[] = [];
    window.addEventListener(AUTH_EXPIRED_EVENT, sesionVencida);
    const escuchar = (e: Event) => avisos.push((e as CustomEvent).detail.detalles?.mensaje ?? '');
    window.addEventListener('sync-status', escuchar);
    const temporizador = vi.spyOn(globalThis, 'setTimeout');

    await syncService.sincronizarIngresosPendientes();

    window.removeEventListener(AUTH_EXPIRED_EVENT, sesionVencida);
    window.removeEventListener('sync-status', escuchar);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(temporizador.mock.calls.some(([, demora]) => demora === 5000)).toBe(false);
    expect(await db.ingresos_pendientes.toArray()).toHaveLength(1);
    expect(sesionVencida).toHaveBeenCalledTimes(1);
    expect(avisos.some((m) => /iniciá sesión de nuevo/i.test(m))).toBe(true);
    expect(syncService.isSyncing).toBe(false);
  });

  it('Test 13 — un 403 también conserva la cola y no cierra la sesión', async () => {
    await dbService.registrarIngresoManual('44444444', 'Sin Permiso', 0, 'Espontaneo', 10);
    const fetchMock = responder(403);
    const sesionVencida = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, sesionVencida);

    await syncService.sincronizarIngresosPendientes();

    window.removeEventListener(AUTH_EXPIRED_EVENT, sesionVencida);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await db.ingresos_pendientes.toArray()).toHaveLength(1);
    expect(sesionVencida).not.toHaveBeenCalled();
  });

  it('Test 14 — después de volver a iniciar sesión, la cola pendiente se sincroniza', async () => {
    await dbService.registrarIngresoManual('55555555', 'Reanuda', 0, 'Espontaneo', 10);
    responder(401);
    await syncService.sincronizarIngresosPendientes();
    expect(await db.ingresos_pendientes.toArray()).toHaveLength(1);

    // El guardia inicia sesión de nuevo y el siguiente intento ya viaja con el token nuevo
    localStorage.setItem(TOKEN_KEY, 'token-nuevo');
    const jti = (await db.ingresos_pendientes.toArray())[0].jti;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ procesados: 1, conflictos: 0, sincronizados_jti: [jti], errores: [] }),
    }) as unknown as typeof fetch;

    await syncService.sincronizarIngresosPendientes();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-nuevo');
    expect(await db.ingresos_pendientes.toArray()).toHaveLength(0);
  });
});
