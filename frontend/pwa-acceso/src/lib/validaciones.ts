// Debe coincidir con MAX_PERSONAS_POR_RESERVA del backend (se puede sobreescribir con VITE_MAX_PERSONAS)
export const MAX_PERSONAS = Number(import.meta.env.VITE_MAX_PERSONAS ?? 10);
// Debe coincidir con MAX_NOCHES_POR_RESERVA del backend (se puede sobreescribir con VITE_MAX_NOCHES)
export const MAX_NOCHES = Number(import.meta.env.VITE_MAX_NOCHES ?? 10);

// Filtros para usar en onChange: impiden escribir/pegar caracteres no permitidos
export const soloDigitos = (v: string) => v.replace(/\D/g, '');
export const limpiarNombre = (v: string) => v.replace(/[^\p{L} .'’-]/gu, '');

const EMAIL_REGEX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const NOMBRE_REGEX = /^\p{L}+(?:[ .'’-]+\p{L}+)*\.?$/u;
const TELEFONO_REGEX = /^[0-9]+$/;

export function hoyISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

export function validarEmail(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El email es obligatorio.';
  if (v.length > 254 || !EMAIL_REGEX.test(v))
    return 'Ingresá un email válido (ej: nombre@correo.com).';
  return null;
}

export function validarNombre(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El nombre es obligatorio.';
  if (v.length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (v.length > 100) return 'El nombre no puede superar los 100 caracteres.';
  if (!NOMBRE_REGEX.test(v))
    return 'El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones.';
  return null;
}

export function validarTelefono(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El teléfono es obligatorio.';
  if (!TELEFONO_REGEX.test(v)) return 'El teléfono solo puede contener números.';
  if (v.length < 8 || v.length > 15) return 'El teléfono debe tener entre 8 y 15 dígitos.';
  return null;
}

export function validarCantidadPersonas(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'La cantidad de personas es obligatoria.';
  if (!/^\d+$/.test(v)) return 'Ingresá un número entero válido.';
  const n = Number(v);
  if (n < 1) return 'Debe haber al menos 1 persona.';
  if (n > MAX_PERSONAS) return `El máximo es ${MAX_PERSONAS} personas por reserva.`;
  return null;
}

export function validarEdad(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'La edad es obligatoria.';
  if (!/^\d+$/.test(v)) return 'Ingresá una edad válida.';
  if (Number(v) > 120) return 'Ingresá una edad válida (máximo 120).';
  return null;
}

export function validarDni(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'El DNI es obligatorio para socios.';
  if (!/^\d{7,8}$/.test(v)) return 'El DNI debe tener 7 u 8 dígitos, sin puntos.';
  return null;
}

export function validarFecha(valor: string, etiqueta = 'La fecha'): string | null {
  const v = valor.trim();
  if (!v) return `${etiqueta} es obligatoria.`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return `${etiqueta} no tiene un formato válido.`;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia)
    return `${etiqueta} no existe en el calendario.`;
  return null;
}

export function validarFechasEstadia(
  ingreso: string,
  egreso: string,
  hoy: string = hoyISO()
): { ingreso?: string; egreso?: string } {
  const errores: { ingreso?: string; egreso?: string } = {};
  const eIngreso = validarFecha(ingreso, 'La fecha de ingreso');
  const eEgreso = validarFecha(egreso, 'La fecha de egreso');
  if (eIngreso) errores.ingreso = eIngreso;
  else if (ingreso < hoy) errores.ingreso = 'La fecha de ingreso no puede ser anterior a hoy.';
  if (eEgreso) errores.egreso = eEgreso;
  else if (!eIngreso && egreso < ingreso)
    errores.egreso = 'La fecha de egreso no puede ser anterior a la de ingreso.';
  return errores;
}

export function validarNoches(valor: string): string | null {
  const v = valor.trim();
  if (!v) return 'La cantidad de noches es obligatoria.';
  if (!/^\d+$/.test(v)) return 'Ingresá un número entero de noches.';
  const n = Number(v);
  if (n < 1) return 'Tiene que ser al menos 1 noche.';
  if (n > MAX_NOCHES) return `El máximo es ${MAX_NOCHES} noches por reserva.`;
  return null;
}