// @vitest-environment node

import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IJwtPayload } from '../types/security';
import { diaEnArgentina } from '../utils/vigenciaQR';

describe('validarAccesoQR - integración JWT + Blacklist IndexedDB (Issue 8.2)', () => {
  let validToken: string;
  let manipulatedToken: string;
  let testPayload: IJwtPayload;
  let tokensEstadia: Record<'conEgr' | 'sinEgr' | 'sinDat' | 'fechaRota', string>;
  let db: typeof import('../db/db').db;
  let validarAccesoQR: typeof import('./accessValidationService').validarAccesoQR;

  beforeAll(async () => {
    // 1) Firmamos los JWT de prueba con jose ANTES de importar fake-indexeddb.
    // Nota técnica: se detectó que importar 'fake-indexeddb/auto' antes de
    // usar jose rompe internamente la ruta de firmado de jose (SignJWT.sign
    // falla con "payload must be an instance of Uint8Array"), por un
    // conflicto de efectos globales entre ambas librerías bajo jsdom+Vitest.
    // Firmando primero evitamos el problema sin tocar la lógica de negocio.
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const publicPem = await exportSPKI(publicKey);
    vi.stubEnv('VITE_PUBLIC_KEY', publicPem);

    const now = Math.floor(Date.now() / 1000);
    const hoy = diaEnArgentina(new Date());
    testPayload = {
      jti: 'jti-8-2-test',
      reserva_id: 'reserva-8-2-test',
      camping_id: 'CAMP-01',
      iat: now,
      cantidad_personas: 3,
      typ: 'visitante',
      exp: now + 3600,
      dat: hoy,
      egr: hoy,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validToken = await new SignJWT(testPayload as any)
      .setProtectedHeader({ alg: 'ES256' })
      .sign(privateKey);

    // Issue 28.1: QR de una estadía del 27 al 29/11/2026. exp es la medianoche de Argentina del 30/11,
    // igual que lo firma el backend. "sinEgr" es un QR emitido antes de la 28.1
    const base = {
      jti: 'jti-28-1',
      reserva_id: 'reserva-28-1',
      camping_id: 'CAMP-01',
      iat: Date.UTC(2026, 10, 20) / 1000,
      cantidad_personas: 2,
      typ: 'visitante',
      exp: Date.UTC(2026, 10, 30, 3, 0, 0) / 1000,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firmar = (claims: Record<string, unknown>) => new SignJWT(claims as any)
      .setProtectedHeader({ alg: 'ES256' })
      .sign(privateKey);
    tokensEstadia = {
      conEgr: await firmar({ ...base, dat: '2026-11-27', egr: '2026-11-29' }),
      sinEgr: await firmar({ ...base, dat: '2026-11-27' }),
      sinDat: await firmar({ ...base }),
      fechaRota: await firmar({ ...base, dat: '27/11/2026', egr: '2026-11-29' }),
    };

    // Token con la firma corrompida (para el Caso 3)
    manipulatedToken = validToken.slice(0, -5) + 'abcde';

    // 2) Recién ahora activamos fake-indexeddb e importamos dinámicamente
    // los módulos que dependen de Dexie/IndexedDB (db.ts instancia Dexie
    // al ser importado, por eso necesita indexedDB ya registrado en global).
    await import('fake-indexeddb/auto');
    ({ db } = await import('../db/db'));
    ({ validarAccesoQR } = await import('./accessValidationService'));
  });

  afterEach(async () => {
    // Restauramos el estado de IndexedDB para no afectar otros tests
    await db.blacklist.clear();
  });

  it('Caso 1: JWT válido pero revocado -> rechaza el ingreso con status REVOKED', async () => {
    await db.blacklist.put({
      id: testPayload.reserva_id,
      fechaCancelacion: new Date().toISOString(),
    });

    const resultado = await validarAccesoQR(validToken);

    expect(resultado.status).toBe('REVOKED');
    if (resultado.status === 'REVOKED') {
      expect(resultado.payload.reserva_id).toBe(testPayload.reserva_id);
    }
  });

  it('Caso 2: JWT válido y no revocado -> autoriza el ingreso con status VALID', async () => {
    const existente = await db.blacklist.get(testPayload.reserva_id);
    expect(existente).toBeUndefined();

    const resultado = await validarAccesoQR(validToken);

    expect(resultado.status).toBe('VALID');
    if (resultado.status === 'VALID') {
      expect(resultado.payload.reserva_id).toBe(testPayload.reserva_id);
      expect(resultado.payload.cantidad_personas).toBe(3);
    }
  });

  it('Caso 4 (Issue 20.4): la reserva llegó en la lista descargada del servidor -> REVOKED', async () => {
    const { dbService } = await import('./dbService');
    await dbService.reemplazarBlacklist(['otra-reserva', testPayload.reserva_id]);

    const resultado = await validarAccesoQR(validToken);

    expect(resultado.status).toBe('REVOKED');
  });

  it('Caso 5 (Issue 20.4): si la reserva salió de la lista en la siguiente descarga -> VALID', async () => {
    const { dbService } = await import('./dbService');
    await dbService.reemplazarBlacklist([testPayload.reserva_id]);
    await dbService.reemplazarBlacklist(['otra-reserva']);

    const resultado = await validarAccesoQR(validToken);

    expect(resultado.status).toBe('VALID');
  });

  it('Caso 3: JWT con firma inválida -> INVALID_TOKEN, nunca REVOKED', async () => {
    // Aunque el identificador esté en blacklist, la firma inválida debe
    // cortar el flujo antes de llegar a consultarla.
    await db.blacklist.put({
      id: testPayload.reserva_id,
      fechaCancelacion: new Date().toISOString(),
    });

    const resultado = await validarAccesoQR(manipulatedToken);

    expect(resultado.status).toBe('INVALID_TOKEN');
    expect(resultado.status).not.toBe('REVOKED');
  });

  // ---------------------------------------------------------------------------------------
  // Issue 28.1: el QR solo sirve dentro de su estadía, aun sin internet
  // ---------------------------------------------------------------------------------------
  describe('vigencia por fecha (Issue 28.1)', () => {
    // Solo se simula Date: fake-indexeddb y Dexie necesitan los timers reales
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // Las horas son de Buenos Aires (-03:00). Estadía: 27, 28 y 29 de noviembre
    const MOMENTOS: Array<[string, string, 'VALID' | 'FUERA_DE_FECHA']> = [
      ['día anterior (26/11 23:59:59)', '2026-11-26T23:59:59-03:00', 'FUERA_DE_FECHA'],
      ['primer día (27/11 00:00:00)', '2026-11-27T00:00:00-03:00', 'VALID'],
      ['último día (29/11 23:59:59)', '2026-11-29T23:59:59-03:00', 'VALID'],
      ['día posterior (30/11 00:00:00)', '2026-11-30T00:00:00-03:00', 'FUERA_DE_FECHA'],
      // 22:30 en Argentina ya es el día siguiente en UTC: el caso que rompía con la fecha UTC
      ['último día a las 22:30 (UTC ya marca 30/11)', '2026-11-29T22:30:00-03:00', 'VALID'],
      ['día anterior a las 22:30 (UTC ya marca 27/11)', '2026-11-26T22:30:00-03:00', 'FUERA_DE_FECHA'],
    ];

    it.each(MOMENTOS)('QR con egr, %s -> %s', async (_nombre, momento, esperado) => {
      vi.setSystemTime(new Date(momento));

      const resultado = await validarAccesoQR(tokensEstadia.conEgr);

      expect(resultado.status).toBe(esperado);
    });

    it.each(MOMENTOS)('QR emitido antes de la 28.1 (sin egr), %s -> %s', async (_nombre, momento, esperado) => {
      vi.setSystemTime(new Date(momento));

      const resultado = await validarAccesoQR(tokensEstadia.sinEgr);

      expect(resultado.status).toBe(esperado);
    });

    it('un QR fuera de fecha no consulta ni necesita la lista de revocados', async () => {
      vi.setSystemTime(new Date('2026-11-26T12:00:00-03:00'));
      await db.blacklist.put({ id: 'reserva-28-1', fechaCancelacion: new Date().toISOString() });

      const resultado = await validarAccesoQR(tokensEstadia.conEgr);

      expect(resultado.status).toBe('FUERA_DE_FECHA');
    });

    it('un QR dentro de fecha de una reserva cancelada sigue siendo REVOKED', async () => {
      vi.setSystemTime(new Date('2026-11-28T12:00:00-03:00'));
      await db.blacklist.put({ id: 'reserva-28-1', fechaCancelacion: new Date().toISOString() });

      const resultado = await validarAccesoQR(tokensEstadia.conEgr);

      expect(resultado.status).toBe('REVOKED');
    });

    it('un QR auténtico sin dat o con una fecha ilegible se rechaza como INVALID_TOKEN', async () => {
      vi.setSystemTime(new Date('2026-11-28T12:00:00-03:00'));

      expect((await validarAccesoQR(tokensEstadia.sinDat)).status).toBe('INVALID_TOKEN');
      expect((await validarAccesoQR(tokensEstadia.fechaRota)).status).toBe('INVALID_TOKEN');
    });

    it('un QR con la firma alterada sigue siendo INVALID_TOKEN aunque la fecha sea la correcta', async () => {
      vi.setSystemTime(new Date('2026-11-28T12:00:00-03:00'));
      const alterado = tokensEstadia.conEgr.slice(0, -5) + 'abcde';

      expect((await validarAccesoQR(alterado)).status).toBe('INVALID_TOKEN');
    });
  });
});
