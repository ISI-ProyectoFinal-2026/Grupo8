// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT, TOKEN_KEY } from '@/context/AuthContext';
import { db } from '../db/db';
import { sincronizarBootstrap } from './bootstrapService';
import { dbService } from './dbService';

const bootstrapCon = (capacidad: unknown) => ({
  ok: true,
  json: async () => ({
    blacklist: [],
    configuracion: { capacidad_maxima: capacidad, buffer_seguridad: 10 },
    clave_publica: 'clave',
    pagina_actual: 1,
    tiene_mas_paginas: false,
  }),
});

describe('bootstrapService — capacidad máxima (Issue 16.5)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
  });

  it('descarga la capacidad y la guarda en IndexedDB', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(bootstrapCon(50));
    vi.stubGlobal('fetch', fetchFalso);

    const capacidad = await sincronizarBootstrap();

    expect(capacidad).toBe(50);
    expect(await dbService.obtenerCapacidadMaxima()).toBe(50);
    expect(String(fetchFalso.mock.calls[0][0])).toContain('/api/v1/sincronizacion/bootstrap');
  });

  it('sin red y sin datos locales devuelve null, no guarda nada y no lanza', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
    expect(await dbService.obtenerCapacidadMaxima()).toBeNull();
  });

  it('sin red conserva la capacidad que ya estaba guardada', async () => {
    await dbService.guardarCapacidadMaxima(80);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
    expect(await dbService.obtenerCapacidadMaxima()).toBe(80);
  });

  it('si el servidor responde con error HTTP devuelve null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
    expect(await dbService.obtenerCapacidadMaxima()).toBeNull();
  });

  it.each([0, -5, 12.5, '50', null])('una capacidad inválida (%s) no se guarda y no pisa la anterior', async (invalida) => {
    await dbService.guardarCapacidadMaxima(80);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootstrapCon(invalida)));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
    expect(await dbService.obtenerCapacidadMaxima()).toBe(80);
  });

  it('una respuesta sin la sección de configuración se trata como inválida', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'otro' }) }));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
  });

  it('si el servidor cambió la capacidad, se actualiza la guardada', async () => {
    await dbService.guardarCapacidadMaxima(80);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootstrapCon(120)));

    await sincronizarBootstrap();

    expect(await dbService.obtenerCapacidadMaxima()).toBe(120);
  });
});
// Una página del bootstrap con la lista de reservas canceladas
const pagina = (blacklist: unknown, tieneMas = false, capacidad: unknown = 50) => ({
  ok: true,
  status: 200,
  json: async () => ({
    blacklist,
    configuracion: { capacidad_maxima: capacidad, buffer_seguridad: 10 },
    clave_publica: 'clave',
    pagina_actual: 1,
    tiene_mas_paginas: tieneMas,
  }),
});
const sinRed = () => Promise.reject(new TypeError('Failed to fetch'));

async function idsGuardados(): Promise<string[]> {
  return (await db.blacklist.toArray()).map((e) => e.id).sort();
}

describe('bootstrapService — lista de reservas canceladas (Issue 20.4)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    await db.blacklist.clear();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
    await db.blacklist.clear();
    localStorage.clear();
  });

  it('pide la primera página completa con el token del guardia', async () => {
    localStorage.setItem(TOKEN_KEY, 'token-del-guardia');
    const fetchFalso = vi.fn().mockResolvedValue(pagina([]));
    vi.stubGlobal('fetch', fetchFalso);

    await sincronizarBootstrap();

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/sincronizacion\/bootstrap\?page=1&limit=1000$/);
    expect(opciones.headers).toEqual({ Authorization: 'Bearer token-del-guardia' });
  });

  it('sin sesión pide igual, sin el encabezado de autorización', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(pagina([]));
    vi.stubGlobal('fetch', fetchFalso);

    await sincronizarBootstrap();

    expect(fetchFalso.mock.calls[0][1].headers).toEqual({});
  });

  it('guarda la lista: las reservas canceladas quedan revocadas y las demás no', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pagina(['cancelada-1', 'cancelada-2'])));

    await sincronizarBootstrap();

    expect(await dbService.verificarAccesoRevocado('cancelada-1')).toBe(true);
    expect(await dbService.verificarAccesoRevocado('cancelada-2')).toBe(true);
    expect(await dbService.verificarAccesoRevocado('otra-reserva')).toBe(false);
  });

  it('descarga todas las páginas hasta que el servidor dice que no hay más', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(pagina(['a', 'b'], true))
      .mockResolvedValueOnce(pagina(['c', 'd'], true))
      .mockResolvedValueOnce(pagina(['e'], false));
    vi.stubGlobal('fetch', fetchFalso);

    await sincronizarBootstrap();

    expect(fetchFalso).toHaveBeenCalledTimes(3);
    expect(String(fetchFalso.mock.calls[1][0])).toContain('page=2&limit=1000');
    expect(String(fetchFalso.mock.calls[2][0])).toContain('page=3&limit=1000');
    expect(await idsGuardados()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('reemplaza la lista anterior: lo que ya no manda el servidor se borra', async () => {
    await dbService.reemplazarBlacklist(['vieja', 'sigue']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pagina(['sigue', 'nueva'])));

    await sincronizarBootstrap();

    expect(await idsGuardados()).toEqual(['nueva', 'sigue']);
  });

  it('una lista vacía del servidor deja la local vacía', async () => {
    await dbService.reemplazarBlacklist(['vieja']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pagina([])));

    await sincronizarBootstrap();

    expect(await idsGuardados()).toEqual([]);
  });

  it('si falla una página intermedia conserva la lista anterior completa, pero guarda la capacidad', async () => {
    await dbService.reemplazarBlacklist(['vieja-1', 'vieja-2']);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(pagina(['nueva-1'], true, 70)).mockImplementationOnce(sinRed)
    );

    const capacidad = await sincronizarBootstrap();

    expect(await idsGuardados()).toEqual(['vieja-1', 'vieja-2']);
    expect(capacidad).toBe(70);
    expect(await dbService.obtenerCapacidadMaxima()).toBe(70);
  });

  it('sin red conserva la lista que ya estaba guardada', async () => {
    await dbService.reemplazarBlacklist(['vieja']);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(sinRed));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
    expect(await idsGuardados()).toEqual(['vieja']);
  });

  it.each([
    ['no es una lista', 'abc'],
    ['tiene un número', ['ok', 1234]],
    ['tiene un texto vacío', ['ok', '']],
    ['no viene', undefined],
  ])('una lista con formato inválido (%s) no pisa la anterior', async (_caso, invalida) => {
    await dbService.reemplazarBlacklist(['vieja']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pagina(invalida)));

    await sincronizarBootstrap();

    expect(await idsGuardados()).toEqual(['vieja']);
  });

  it('una capacidad inválida no impide guardar la lista', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pagina(['cancelada'], false, 0)));

    await expect(sincronizarBootstrap()).resolves.toBeNull();
    expect(await idsGuardados()).toEqual(['cancelada']);
  });

  it('con 401 avisa que la sesión venció y conserva la lista', async () => {
    await dbService.reemplazarBlacklist(['vieja']);
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    await expect(sincronizarBootstrap()).resolves.toBeNull();

    expect(escuchador).toHaveBeenCalledTimes(1);
    expect(await idsGuardados()).toEqual(['vieja']);
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });

  it('con 403 no cierra la sesión', async () => {
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));

    await sincronizarBootstrap();

    expect(escuchador).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });

  it('si el servidor nunca dice que terminó, corta y no guarda una lista a medias', async () => {
    await dbService.reemplazarBlacklist(['vieja']);
    const fetchFalso = vi.fn().mockImplementation(() => Promise.resolve(pagina(['x'], true)));
    vi.stubGlobal('fetch', fetchFalso);

    await sincronizarBootstrap();

    expect(fetchFalso).toHaveBeenCalledTimes(100);
    expect(await idsGuardados()).toEqual(['vieja']);
  });
});
