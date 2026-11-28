// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { CLAVE_SESION, dbService } from './dbService';

describe('Sesión del guardia en IndexedDB (28.2)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
  });
  afterEach(async () => {
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
  });

  it('sin sesión guardada devuelve null', async () => {
    expect(await dbService.obtenerSesion()).toBeNull();
  });

  it('guarda y lee el token y el rol, con la hora en que se guardó', async () => {
    await dbService.guardarSesion('un.token.cualquiera', 'SEGURIDAD');

    const sesion = await dbService.obtenerSesion();

    expect(sesion?.token).toBe('un.token.cualquiera');
    expect(sesion?.rol).toBe('SEGURIDAD');
    expect(Number.isNaN(Date.parse(sesion!.guardada_en))).toBe(false);
  });

  it('guardar de nuevo reemplaza la sesión anterior (queda una sola)', async () => {
    await dbService.guardarSesion('token-viejo', 'SEGURIDAD');
    await dbService.guardarSesion('token-nuevo', 'SEGURIDAD');

    expect((await dbService.obtenerSesion())?.token).toBe('token-nuevo');
    expect(
      await db.configuracion.where('clave').equals(CLAVE_SESION).count()
    ).toBe(1);
  });

  it('eliminar borra la sesión', async () => {
    await dbService.guardarSesion('token', 'SEGURIDAD');

    await dbService.eliminarSesion();

    expect(await dbService.obtenerSesion()).toBeNull();
  });

  it('eliminar sin sesión guardada no falla', async () => {
    await expect(dbService.eliminarSesion()).resolves.toBeUndefined();
  });

  it('eliminar la sesión conserva los ingresos pendientes, el historial y el resto de la configuración', async () => {
    await dbService.registrarIngresoManual(
      '30111222',
      'Ana',
      1,
      'Espontaneo',
      100
    );
    await dbService.registrarIngresoManual(
      '30111223',
      'Beto',
      0,
      'Espontaneo',
      100
    );
    await dbService.guardarConfiguracion(
      'ultima_sincronizacion',
      '2026-11-28T10:00:00.000Z'
    );
    await dbService.guardarSesion('token', 'SEGURIDAD');
    const pendientesAntes = await db.ingresos_pendientes.toArray();
    const historialAntes = await db.historial.count();

    await dbService.eliminarSesion();

    expect(await db.ingresos_pendientes.toArray()).toEqual(pendientesAntes);
    expect(await db.ingresos_pendientes.count()).toBe(2);
    expect(await db.historial.count()).toBe(historialAntes);
    expect(await dbService.obtenerConfiguracion('ultima_sincronizacion')).toBe(
      '2026-11-28T10:00:00.000Z'
    );
  });

  it.each([
    ['un texto', 'hola'],
    [
      'sin token',
      { rol: 'SEGURIDAD', guardada_en: '2026-11-28T10:00:00.000Z' },
    ],
    [
      'token vacío',
      { token: '', rol: 'SEGURIDAD', guardada_en: '2026-11-28T10:00:00.000Z' },
    ],
    [
      'token que no es texto',
      { token: 123, rol: 'SEGURIDAD', guardada_en: '2026-11-28T10:00:00.000Z' },
    ],
    ['sin rol', { token: 'x', guardada_en: '2026-11-28T10:00:00.000Z' }],
  ])(
    'si lo guardado está dañado (%s) se trata como si no hubiera sesión',
    async (_nombre, valor) => {
      await db.configuracion.put({ clave: CLAVE_SESION, valor });

      expect(await dbService.obtenerSesion()).toBeNull();
    }
  );
});
