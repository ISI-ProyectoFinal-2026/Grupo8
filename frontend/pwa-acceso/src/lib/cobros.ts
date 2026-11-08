import { sumarDias } from './fechas';

/** Días que se muestran al abrir el resumen, contando hoy. */
export const DIAS_POR_DEFECTO = 7;
/** Rango máximo que acepta el backend. */
export const MAX_DIAS_RANGO = 92;

/** Fecha de hoy en Buenos Aires, como AAAA-MM-DD (el formato de los input date). */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  // en-CA escribe las fechas como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

export function rangoPorDefecto(ahora: Date = new Date()): { desde: string; hasta: string } {
  const hasta = hoyEnArgentina(ahora);
  return { desde: sumarDias(hasta, -(DIAS_POR_DEFECTO - 1)), hasta };
}

/** Cantidad de días entre dos fechas AAAA-MM-DD, contando las dos. */
export function diasDelRango(desde: string, hasta: string): number {
  const aUtc = (fecha: string) => {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return Date.UTC(anio, mes - 1, dia);
  };
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000) + 1;
}

export function validarRango(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return 'Elegí las dos fechas.';
  // Las fechas AAAA-MM-DD se pueden comparar como texto
  if (desde > hasta) return 'La fecha "desde" no puede ser posterior a "hasta".';
  if (diasDelRango(desde, hasta) > MAX_DIAS_RANGO) {
    return `El rango no puede superar los ${MAX_DIAS_RANGO} días.`;
  }
  return null;
}
