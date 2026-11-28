/**
 * Interfaz que define la estructura del payload decodificado del código QR.
 * Debe mantenerse estrictamente sincronizada con JWTPayloadSchema del backend.
 */
export interface IJwtPayload {
  jti: string;
  reserva_id: string; // Es un UUID.
  camping_id: string; // Debe ser string para hacer match con el backend (ej: "CAMP-01")
  iat: number;        // Timestamp UNIX de cuándo se generó
  cantidad_personas: number;
  typ: 'socio' | 'visitante'; // Tipo de cliente para lógica visual en la PWA
  exp: number;        // Timestamp UNIX de expiración
  dat: string;        // Primer día válido: fecha de ingreso de la reserva (YYYY-MM-DD)
  // Último día válido: fecha de egreso (YYYY-MM-DD). En el backend es obligatorio, pero acá es
  // opcional porque los QR emitidos antes de la 28.1 no lo traen (ver utils/vigenciaQR.ts)
  egr?: string;
}