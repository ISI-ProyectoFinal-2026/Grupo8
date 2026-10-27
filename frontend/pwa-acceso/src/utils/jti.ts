/**
 * Genera un identificador único para un ingreso registrado en este dispositivo.
 * Usa crypto.randomUUID(); si el navegador no lo tiene (contexto no seguro o Safari viejo)
 * arma un UUID v4 con crypto.getRandomValues, que sí está disponible.
 */
const uuidV4 = (): string => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const generarJti = (prefijo: 'manual' | 'qr' = 'manual'): string => `${prefijo}-${uuidV4()}`;