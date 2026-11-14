// Cálculos del monitor de ocupación del panel (sin llamadas a la red).

/** Desde este porcentaje la barra se pone amarilla. */
export const UMBRAL_AMARILLO = 70;
/** Desde este porcentaje la barra se pone roja. */
export const UMBRAL_ROJO = 90;

export type NivelOcupacion = 'verde' | 'amarillo' | 'rojo';

/** Porcentaje entero de ocupación. Puede pasar de 100 si entró más gente que la capacidad. */
export function porcentajeOcupacion(ocupacion: number, capacidad: number): number {
  if (capacidad <= 0) return 0;
  return Math.round((ocupacion * 100) / capacidad);
}

export function nivelOcupacion(porcentaje: number): NivelOcupacion {
  if (porcentaje >= UMBRAL_ROJO) return 'rojo';
  if (porcentaje >= UMBRAL_AMARILLO) return 'amarillo';
  return 'verde';
}

/** Parte de la barra que ocupa el buffer offline, en porcentaje (0 a 100). */
export function porcentajeBuffer(buffer: number, capacidad: number): number {
  if (capacidad <= 0 || buffer <= 0) return 0;
  return Math.min((buffer * 100) / capacidad, 100);
}

/**
 * Valida la cantidad del formulario de egresos. `dentro` es la ocupación conocida;
 * si todavía no se cargó, el control final lo hace el backend.
 */
export function validarCantidadEgreso(valor: string, dentro: number | null): string | null {
  const texto = valor.trim();
  if (texto === '') return 'Ingresá cuántas personas salen.';
  if (!/^\d+$/.test(texto)) return 'Ingresá un número entero de personas.';

  const cantidad = Number(texto);
  if (cantidad < 1) return 'Tiene que salir al menos 1 persona.';
  if (dentro !== null && cantidad > dentro) {
    return dentro === 1
      ? 'Solo hay 1 persona dentro del camping.'
      : `Solo hay ${dentro} personas dentro del camping.`;
  }
  return null;
}

/**
 * Texto de las personas esperadas para el inicio del panel.
 * Ej: "Se esperan 34 personas de 9 reservas".
 */
export function textoEsperados(reservas: number, personas: number): string {
  if (reservas <= 0) return 'No se esperan más ingresos por reservas web hoy.';
  const verbo = personas === 1 ? 'Se espera' : 'Se esperan';
  const textoPersonas = personas === 1 ? '1 persona' : `${personas} personas`;
  const textoReservas = reservas === 1 ? '1 reserva' : `${reservas} reservas`;
  return `${verbo} ${textoPersonas} de ${textoReservas}`;
}
