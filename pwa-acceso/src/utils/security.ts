import { jwtVerify, importSPKI } from 'jose';
import type { IJwtPayload } from '../types/security';

/**
 * Verifica matemáticamente la autenticidad de un código QR offline.
 * Utiliza la Clave Pública inyectada en tiempo de compilación.
 * * @param token - El string JWT escaneado desde el código QR.
 * @returns El payload decodificado si es válido, o null si fue manipulado/expirado.
 */
export async function verifyQRToken(token: string): Promise<IJwtPayload | null> {
    try {
        // 1. Acceso a la variable de entorno inyectada por Vite (Fail-Fast)
        const publicKeyPem = import.meta.env.VITE_PUBLIC_KEY;
        if (!publicKeyPem) {
            throw new Error("Configuración crítica: VITE_PUBLIC_KEY ausente.");
        }

        // 2. Formateo de saltos de línea (por si el .env los inyecta como literales)
        const cleanPublicKey = publicKeyPem.replace(/\\n/g, '\n');

        // 3. Conversión de formato PEM a objeto CryptoKey nativo del navegador
        const publicKey = await importSPKI(cleanPublicKey, 'ES256');

        // 4. Verificación criptográfica
        // jwtVerify automáticamente arroja error si la firma es inválida o si el token expiró (campo 'exp')
        const { payload } = await jwtVerify(token, publicKey, {
            algorithms: ['ES256'],
        });

        // 5. Retorno del payload fuertemente tipado
        return payload as unknown as IJwtPayload;

    } catch (error) {
        // Encapsulamos el error para no romper la UI del escáner. 
        // Retornar null indica explícitamente a la vista que el acceso es denegado.
        console.error("❌ QR Rechazado (Firma inválida o token expirado):", error);
        return null;
    }
}