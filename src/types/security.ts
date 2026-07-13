/**
 * Interfaz que define la estructura del payload decodificado del código QR.
 * Debe mantenerse estrictamente sincronizada con JWTPayloadSchema del backend.
 */
export interface IJwtPayload {
    jti: string;
    reserva_id: number;
    camping_id: number;
    iat: number; // Timestamp UNIX de cuándo se generó
    cantidad_personas: number;
    typ: 'socio' | 'visitante'; // Tipo de cliente para lógica visual en la PWA
    exp: number; // Timestamp UNIX de expiración
    dat: string; // Fecha exacta de validez (formato YYYY-MM-DD)
}