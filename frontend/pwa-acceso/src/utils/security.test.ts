import { describe, it, expect, beforeAll, vi } from 'vitest';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { verifyQRToken } from './security';
import type { IJwtPayload } from '../types/security';

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
            jti: "test-uuid-123",
            reserva_id: 99,
            camping_id: 1,
            iat: now,
            cantidad_personas: 2,
            typ: "visitante",
            exp: now + 3600, // Expira en 1 hora
            dat: "2026-10-10"
        };

        // 4. Firmamos un token válido con la clave privada de prueba
        validToken = await new SignJWT(testPayload as any)
            .setProtectedHeader({ alg: 'ES256' })
            .sign(privateKey);

        // 5. Creamos un token manipulado (cambiamos una letra de la firma)
        manipulatedToken = validToken.slice(0, -5) + "abcde";
    });

    it('Debe retornar el payload decodificado cuando el token es válido', async () => {
        const result = await verifyQRToken(validToken);
        
        expect(result).not.toBeNull();
        expect(result?.reserva_id).toBe(99);
        expect(result?.typ).toBe('visitante');
    });

    it('Debe retornar null cuando el token ha sido manipulado (firma inválida)', async () => {
        const result = await verifyQRToken(manipulatedToken);
        
        expect(result).toBeNull();
    });

    it('Debe retornar null si el token está expirado', async () => {
        // Generamos un nuevo par de claves/token para simular expiración
        const { publicKey, privateKey } = await generateKeyPair('ES256');
        vi.stubEnv('VITE_PUBLIC_KEY', await exportSPKI(publicKey));

        const expiredPayload = { ...testPayload, exp: Math.floor(Date.now() / 1000) - 3600 }; // Expiró hace 1 hora
        const expiredToken = await new SignJWT(expiredPayload as any)
            .setProtectedHeader({ alg: 'ES256' })
            .sign(privateKey);

        const result = await verifyQRToken(expiredToken);
        
        expect(result).toBeNull();
    });
});