// El input date nos da "2026-12-20". Lo mostramos como dd/mm/aaaa a mano,
// porque new Date("2026-12-20") lo toma como UTC y en Argentina se ve el día anterior.
export function formatearFecha(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split("-");
  return `${dia}/${mes}/${anio}`;
}
