// Tipos de reserva (carpa, cabaña...): los define el administrador en el panel y la web de
// reservas los lee del backend. Ningún tipo ni precio se escribe a mano en el frontend.
import { ErrorApi } from '@/lib/descuentos';
import { MAX_NOCHES } from '@/lib/validaciones';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000';

export type FormaCobro = 'POR_PERSONA' | 'POR_UNIDAD';

/** Lo que devuelve GET /api/v1/tipos-reserva: solo los tipos activos. */
export interface TipoReserva {
  id: string;
  nombre: string;
  precio: number;
  forma_cobro: FormaCobro;
  max_personas: number;
  /** Unidades por noche (cabañas). null = sin límite. */
  cantidad_unidades: number | null;
}

/** Lo que ve el administrador: también los desactivados. */
export interface TipoReservaAdmin extends TipoReserva {
  activo: boolean;
}

export const esPorUnidad = (tipo: Pick<TipoReserva, 'forma_cobro'>) =>
  tipo.forma_cobro === 'POR_UNIDAD';

export function formatearPrecio(valor: number): string {
  return `$${valor.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** "$5.000 por persona" o "$25.000 por noche". */
export function describirPrecio(
  tipo: Pick<TipoReserva, 'precio' | 'forma_cobro'>
): string {
  return `${formatearPrecio(tipo.precio)} ${esPorUnidad(tipo) ? 'por noche' : 'por persona'}`;
}

// ---------- Web de reservas ----------

/** Cantidad de personas según el máximo del tipo elegido. */
export function validarCantidadParaTipo(
  valor: string,
  tipo: TipoReserva
): string | null {
  const v = valor.trim();
  if (!v) return 'La cantidad de personas es obligatoria.';
  if (!/^\d+$/.test(v)) return 'Ingresá un número entero válido.';
  const n = Number(v);
  if (n < 1) return 'Debe haber al menos 1 persona.';
  if (n > tipo.max_personas)
    return `${tipo.nombre} admite como máximo ${tipo.max_personas} personas.`;
  return null;
}

/** Por persona se puede pasar el día (0 noches); por unidad hace falta al menos una noche. */
export function validarNochesParaTipo(
  valor: string,
  tipo: TipoReserva
): string | null {
  const v = valor.trim();
  if (!v) return 'La cantidad de noches es obligatoria.';
  if (!/^\d+$/.test(v)) return 'Ingresá un número entero de noches.';
  const n = Number(v);
  if (esPorUnidad(tipo) && n < 1)
    return `${tipo.nombre} se reserva por al menos 1 noche.`;
  if (n > MAX_NOCHES) return `El máximo es ${MAX_NOCHES} noches por reserva.`;
  return null;
}

export async function obtenerTiposActivos(
  signal?: AbortSignal
): Promise<TipoReserva[]> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/tipos-reserva`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ErrorApi('No se pudo conectar con el servidor.', 0);
  }
  if (!response.ok)
    throw new ErrorApi(
      'No se pudieron cargar los tipos de reserva.',
      response.status
    );
  return (await response.json()) as TipoReserva[];
}

// ---------- Panel de administración ----------

/** Valores del formulario tal como se escriben: los números viajan como texto hasta validarlos. */
export interface TipoFormulario {
  nombre: string;
  precio: string;
  forma_cobro: FormaCobro;
  max_personas: string;
  /** Vacío = sin límite. Solo se usa en los tipos por unidad. */
  cantidad_unidades: string;
  activo: boolean;
}

export type ErroresTipo = Partial<Record<keyof TipoFormulario, string>>;

export const formularioVacio: TipoFormulario = {
  nombre: '',
  precio: '',
  forma_cobro: 'POR_PERSONA',
  max_personas: '',
  cantidad_unidades: '',
  activo: true,
};

export function formularioDesdeTipo(tipo: TipoReservaAdmin): TipoFormulario {
  return {
    nombre: tipo.nombre,
    precio: String(tipo.precio),
    forma_cobro: tipo.forma_cobro,
    max_personas: String(tipo.max_personas),
    cantidad_unidades:
      tipo.cantidad_unidades === null ? '' : String(tipo.cantidad_unidades),
    activo: tipo.activo,
  };
}

const ENTERO = /^\d+$/;
// Hasta 2 decimales; acepta coma o punto
const PRECIO = /^\d+([.,]\d{1,2})?$/;

const aNumero = (valor: string) => Number(valor.trim().replace(',', '.'));

export function validarTipo(form: TipoFormulario): ErroresTipo {
  const errores: ErroresTipo = {};

  const nombre = form.nombre.trim();
  if (!nombre) errores.nombre = 'El nombre es obligatorio.';
  else if (nombre.length < 2 || nombre.length > 80)
    errores.nombre = 'El nombre debe tener entre 2 y 80 caracteres.';

  const precio = form.precio.trim();
  if (!precio) errores.precio = 'El precio es obligatorio.';
  else if (!PRECIO.test(precio))
    errores.precio = 'Ingresá un precio válido, con hasta 2 decimales.';
  else if (aNumero(precio) <= 0)
    errores.precio = 'El precio tiene que ser mayor a 0.';

  const maximo = form.max_personas.trim();
  if (!maximo) errores.max_personas = 'El máximo de personas es obligatorio.';
  else if (!ENTERO.test(maximo))
    errores.max_personas = 'Ingresá un número entero.';
  else if (Number(maximo) < 1)
    errores.max_personas = 'El máximo tiene que ser al menos 1.';

  const unidades = form.cantidad_unidades.trim();
  if (form.forma_cobro === 'POR_UNIDAD' && unidades) {
    if (!ENTERO.test(unidades))
      errores.cantidad_unidades = 'Ingresá un número entero.';
    else if (Number(unidades) < 1)
      errores.cantidad_unidades = 'Tiene que haber al menos 1 unidad.';
  }

  return errores;
}

export function construirPayload(form: TipoFormulario) {
  const unidades = form.cantidad_unidades.trim();
  return {
    nombre: form.nombre.trim(),
    precio: aNumero(form.precio),
    forma_cobro: form.forma_cobro,
    max_personas: Number(form.max_personas.trim()),
    // Los tipos por persona no llevan unidades; por unidad, vacío = sin límite
    cantidad_unidades:
      form.forma_cobro === 'POR_UNIDAD' && unidades ? Number(unidades) : null,
    activo: form.activo,
  };
}

async function extraerMensaje(response: Response): Promise<string> {
  try {
    const cuerpo = await response.json();
    if (Array.isArray(cuerpo.detail)) {
      return cuerpo.detail
        .map((d: { msg: string }) => d.msg.replace(/^Value error, /, ''))
        .join('\n');
    }
    if (typeof cuerpo.detail === 'string') return cuerpo.detail;
  } catch {
    // La respuesta no era JSON: se usa el mensaje genérico.
  }
  return 'No se pudo completar la operación. Intentá de nuevo.';
}

async function pedirAdmin<T>(
  token: string,
  ruta: string,
  metodo: 'GET' | 'POST' | 'PUT',
  cuerpo?: object
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/admin/tipos-reserva${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor.', 0);
  }
  if (!response.ok)
    throw new ErrorApi(await extraerMensaje(response), response.status);
  return (await response.json()) as T;
}

export const listarTipos = (token: string) =>
  pedirAdmin<TipoReservaAdmin[]>(token, '', 'GET');

export const crearTipo = (token: string, form: TipoFormulario) =>
  pedirAdmin<TipoReservaAdmin>(token, '', 'POST', construirPayload(form));

export const modificarTipo = (token: string, id: string, cambios: object) =>
  pedirAdmin<TipoReservaAdmin>(token, `/${id}`, 'PUT', cambios);

/** Al editar se mandan todos los campos: el PUT es parcial, pero así queda igual al formulario. */
export const modificarTipoDesdeFormulario = (
  token: string,
  id: string,
  form: TipoFormulario
) => modificarTipo(token, id, construirPayload(form));
