// @vitest-environment node
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IJwtPayload } from '../types/security';
import { verifyQRToken } from './security';

// Helpers locales solo para manipular el payload de un JWT sin volver a firmarlo.
// No dependen de ninguna librería externa nueva.
function base64UrlEncode(obj: unknown): string {
  const json = JSON.stringify(obj);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode<T = unknown>(str: string): T {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const json = decodeURIComponent(escape(atob(padded)));
  return JSON.parse(json) as T;
}

describe('Security Service: verifyQRToken', () => {
  let validToken: string;
  let manipulatedToken: string;
  let testPayload: IJwtPayload;

  beforeAll(async () => {
    // 1. Generamos un par de claves ES256 on-the-fly solo para el test
    const { publicKey, privateKey } = await generateKeyPair('ES256');

    // 2. Exportamos la clave pública y la inyectamos en el entorno simulado de Vite
    const publicPem = await exportSPKI(publicKey);
    vi.stubEnv('VITE_PUBLIC_KEY', publicPem);

    // 3. Preparamos el payload válido (simulando lo que envía FastAPI)
    const now = Math.floor(Date.now() / 1000);
    testPayload = {
      jti: 'test-uuid-123',
      reserva_id: "f2003696-be77-42d9-b63f-066adf8419da",
      camping_id: "CAMP-01",
      iat: now,
      cantidad_personas: 2,
      typ: 'visitante',
      exp: now + 3600, // Expira en 1 hora
      dat: '2026-10-10',
    };

    // 4. Firmamos un token válido con la clave privada de prueba
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validToken = await new SignJWT(testPayload as any)
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'JWT',
      })
      .sign(privateKey);

    // 5. Creamos un token manipulado (cambiamos una letra de la firma)
    manipulatedToken = validToken.slice(0, -5) + 'abcde';
  });

  it('Debe retornar el payload decodificado cuando el token es válido', async () => {
    const result = await verifyQRToken(validToken);

    expect(result).not.toBeNull();
    expect(result?.reserva_id).toBe('f2003696-be77-42d9-b63f-066adf8419da');
    expect(result?.typ).toBe('visitante');
  });

  it('Debe retornar null cuando el token ha sido manipulado (firma inválida)', async () => {
    const result = await verifyQRToken(manipulatedToken);

    expect(result).toBeNull();
  });

  it('Debe retornar null cuando el payload fue alterado sin volver a firmar (tampering)', async () => {
    // Tomamos el JWT válido y modificamos SOLO el payload decodificado,
    // reutilizando el header y la firma originales (sin volver a firmar).
    const [headerB64, payloadB64, signatureB64] = validToken.split('.');
    const decodedPayload = base64UrlDecode<IJwtPayload>(payloadB64);

    const tamperedPayload = {
      ...decodedPayload,
      cantidad_personas: decodedPayload.cantidad_personas + 3, // 2 -> 5
    };
    const tamperedPayloadB64 = base64UrlEncode(tamperedPayload);
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;

    const result = await verifyQRToken(tamperedToken);

    expect(result).toBeNull();
  });

  it('Debe retornar null si el token está expirado', async () => {
    // Generamos un nuevo par de claves/token para simular expiración
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    vi.stubEnv('VITE_PUBLIC_KEY', await exportSPKI(publicKey));

    const expiredPayload = {
      ...testPayload,
      exp: Math.floor(Date.now() / 1000) - 3600,
    }; // Expiró hace 1 hora
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expiredToken = await new SignJWT(expiredPayload as any)
      .setProtectedHeader({ alg: 'ES256' })
      .sign(privateKey);

    const result = await verifyQRToken(expiredToken);

    expect(result).toBeNull();
  });
});