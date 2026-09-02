// @vitest-environment node

import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IJwtPayload } from '../types/security';

describe('validarAccesoQR - integración JWT + Blacklist IndexedDB (Issue 8.2)', () => {
  let validToken: string;
  let manipulatedToken: string;
  let testPayload: IJwtPayload;
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
    testPayload = {
      jti: 'jti-8-2-test',
      reserva_id: 'reserva-8-2-test',
      camping_id: 'CAMP-01',
      iat: now,
      cantidad_personas: 3,
      typ: 'visitante',
      exp: now + 3600,
      dat: '2026-10-10',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validToken = await new SignJWT(testPayload as any)
      .setProtectedHeader({ alg: 'ES256' })
      .sign(privateKey);

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
});