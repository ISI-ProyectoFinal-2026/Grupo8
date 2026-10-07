// El input date nos da "2026-12-20". Lo mostramos como dd/mm/aaaa a mano,
// porque new Date("2026-12-20") lo toma como UTC y en Argentina se ve el día anterior.
export function formatearFecha(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split("-");
  return `${dia}/${mes}/${anio}`;
}

// Suma días a una fecha "AAAA-MM-DD" usando UTC para evitar problemas de zona horaria/horario de verano
export function sumarDias(fechaIso: string, dias: number): string {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}