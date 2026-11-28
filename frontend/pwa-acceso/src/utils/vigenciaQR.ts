import type { IJwtPayload } from '../types/security';

/** Zona del negocio. Argentina no usa horario de verano, pero se pide la zona por nombre igual. */
export const ZONA_NEGOCIO = 'America/Argentina/Buenos_Aires';

/** Lo que ve el guardia cuando el QR es auténtico pero no corresponde al día de hoy. */
export const MENSAJE_QR_FUERA_DE_FECHA = 'Este QR no es válido para hoy';

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El día de calendario de Buenos Aires de un instante, como "AAAA-MM-DD".
 *
 * No se usa toISOString() (es UTC: desde las 21:00 de Argentina ya marca el día siguiente) ni
 * getDate() (usa la zona del celular, que puede estar mal configurada). Intl con la zona del
 * negocio da el mismo día en cualquier dispositivo y sin conexión.
 */
export function diaEnArgentina(instante: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

export type ResultadoVigenciaQR =
  | { vigente: true }
  | {
      vigente: false;
      motivo: 'ANTES_DEL_INGRESO' | 'DESPUES_DEL_EGRESO' | 'FECHAS_INVALIDAS';
    };

/**
 * Último día válido del QR. Los QR nuevos lo traen en `egr`. Los emitidos antes de la 28.1 no:
 * para esos se usa `exp`, que ya está firmado y es la medianoche de Buenos Aires que sigue al día
 * de egreso, así que un segundo antes cae siempre dentro de ese día.
 * TODO: borrar esta rama cuando hayan vencido todos los QR emitidos sin `egr`.
 */
function ultimoDiaDelQR(
  payload: Pick<IJwtPayload, 'egr' | 'exp'>
): string | null {
  if (payload.egr !== undefined) return payload.egr;
  if (!Number.isFinite(payload.exp)) return null;
  return diaEnArgentina(new Date((payload.exp - 1) * 1000));
}

/**
 * ¿El QR sirve en el día de Buenos Aires de `ahora`? Los dos extremos están incluidos.
 *
 * Se llama con el payload ya verificado: las fechas están dentro de la firma, así que el guardia
 * no puede cambiarlas. Si falta `dat`, o las fechas no tienen forma de fecha, el QR se rechaza
 * (no se adivina un rango).
 */
export function evaluarVigenciaQR(
  payload: Pick<IJwtPayload, 'dat' | 'egr' | 'exp'>,
  ahora: Date = new Date()
): ResultadoVigenciaQR {
  const ingreso = payload.dat;
  const egreso = ultimoDiaDelQR(payload);
  if (
    typeof ingreso !== 'string' ||
    !FECHA_ISO.test(ingreso) ||
    egreso === null ||
    !FECHA_ISO.test(egreso) ||
    egreso < ingreso
  ) {
    return { vigente: false, motivo: 'FECHAS_INVALIDAS' };
  }

  // Con ceros a la izquierda, comparar los textos "AAAA-MM-DD" equivale a comparar las fechas
  const hoy = diaEnArgentina(ahora);
  if (hoy < ingreso) return { vigente: false, motivo: 'ANTES_DEL_INGRESO' };
  if (hoy > egreso) return { vigente: false, motivo: 'DESPUES_DEL_EGRESO' };
  return { vigente: true };
}
