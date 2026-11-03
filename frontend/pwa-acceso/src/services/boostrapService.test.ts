// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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