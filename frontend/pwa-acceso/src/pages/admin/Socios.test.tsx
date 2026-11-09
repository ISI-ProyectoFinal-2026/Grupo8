// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT, AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { Socio } from '@/lib/socios';
import Socios from './Socios';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'admin-1', rol: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

const VIGENTE: Socio = {
  id: 'id-ana',
  nombre: 'Ana Pérez',
  dni: '41234567',
  email: 'ana@correo.com',
  membresia_vence: '2026-12-31',
  membresia_vigente: true,
  activo: true,
};

const VENCIDA: Socio = {
  id: 'id-luis',
  nombre: 'Luis Gómez',
  dni: '30111222',
  email: 'luis@correo.com',
  membresia_vence: '2024-03-05',
  membresia_vigente: false,
  activo: true,
};

interface LlamadaFetch {
  url: string;
  metodo: string;
  headers: Record<string, string>;
  cuerpo: Record<string, unknown> | null;
}

let llamadas: LlamadaFetch[];

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

/** Simula el backend: `responder` decide qué contestar a cada pedido que no sea el listado. */
function simularApi(lista: Socio[], responder?: (llamada: LlamadaFetch) => Response | undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const llamada: LlamadaFetch = {
        url,
        metodo: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        cuerpo: init?.body ? JSON.parse(String(init.body)) : null,
      };
      llamadas.push(llamada);
      const propia = responder?.(llamada);
      if (propia) return propia;
      return llamada.metodo === 'GET' ? respuesta(200, lista) : respuesta(201, VIGENTE);
    })
  );
}

function pedidosDe(metodo: string) {
  return llamadas.filter((l) => l.metodo === metodo);
}

function mostrar() {
  return render(
    <AuthProvider>
      <Socios />
    </AuthProvider>
  );
}

function escribir(etiqueta: string | RegExp, valor: string) {
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
}

function completarFormulario() {
  escribir('Nombre', 'Ana Pérez');
  escribir('DNI', '41234567');
  escribir('Email', 'ana@correo.com');
  escribir('Contraseña inicial', 'inicial123');
  escribir('Vencimiento de la membresía', '2026-12-31');
}

describe('Pantalla de socios (Issue 13.4)', () => {
  beforeEach(() => {
    llamadas = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lista los socios con el token del administrador', async () => {
    simularApi([VIGENTE, VENCIDA]);

    mostrar();

    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    expect(screen.getByText('ana@correo.com')).toBeTruthy();
    expect(screen.getByText('41234567')).toBeTruthy();
    expect(screen.getByText('Luis Gómez')).toBeTruthy();
    const listado = pedidosDe('GET')[0];
    expect(listado.url).toMatch(/\/admin\/socios$/);
    expect(listado.headers.Authorization).toBe(`Bearer ${localStorage.getItem(TOKEN_KEY)}`);
  });

  it('muestra la fecha de vencimiento como dd/mm/aaaa y el estado de cada socio', async () => {
    simularApi([VIGENTE, VENCIDA]);
    mostrar();

    const filaVigente = (await screen.findByText('Ana Pérez')).closest('tr') as HTMLElement;
    const filaVencida = screen.getByText('Luis Gómez').closest('tr') as HTMLElement;

    expect(within(filaVigente).getByText('31/12/2026')).toBeTruthy();
    expect(within(filaVigente).getByText('Vigente')).toBeTruthy();
    expect(within(filaVencida).getByText('05/03/2024')).toBeTruthy();
    expect(within(filaVencida).getByText('Vencida')).toBeTruthy();
  });

  it('muestra un mensaje cuando no hay socios', async () => {
    simularApi([]);

    mostrar();

    expect(await screen.findByText(/todavía no hay socios/i)).toBeTruthy();
  });

  it('muestra un error con opción de reintentar si no se puede cargar la lista', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(500, { detail: 'Error interno' })));

    mostrar();

    expect(await screen.findByText('Error interno')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();
  });

  it('avisa que no hay conexión con el servidor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    mostrar();

    expect(await screen.findByText(/no se pudo conectar/i)).toBeTruthy();
  });

  it('una respuesta 401 emite el evento de sesión vencida', async () => {
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(401, { detail: 'No se pudieron validar las credenciales' }))
    );

    mostrar();

    await waitFor(() => expect(escuchador).toHaveBeenCalled());
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });

  it('da de alta un socio y vuelve a pedir la lista', async () => {
    simularApi([VENCIDA]);
    mostrar();
    await screen.findByText('Luis Gómez');

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));
    completarFormulario();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(pedidosDe('POST')).toHaveLength(1));
    expect(pedidosDe('POST')[0].url).toMatch(/\/admin\/socios$/);
    expect(pedidosDe('POST')[0].headers.Authorization).toBe(`Bearer ${localStorage.getItem(TOKEN_KEY)}`);
    expect(pedidosDe('POST')[0].cuerpo).toEqual({
      nombre: 'Ana Pérez',
      dni: '41234567',
      email: 'ana@correo.com',
      password: 'inicial123',
      membresia_vence: '2026-12-31',
    });
    expect(await screen.findByText('Socio creado.')).toBeTruthy();
    expect(pedidosDe('GET').length).toBeGreaterThan(1);
    // el formulario se cierra
    expect(screen.queryByLabelText('Contraseña inicial')).toBeNull();
  });

  it('la contraseña inicial se escribe oculta', async () => {
    simularApi([]);
    mostrar();
    await screen.findByText(/todavía no hay socios/i);

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));

    expect((screen.getByLabelText('Contraseña inicial') as HTMLInputElement).type).toBe('password');
  });

  it('el DNI solo admite dígitos', async () => {
    simularApi([]);
    mostrar();
    await screen.findByText(/todavía no hay socios/i);

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));
    escribir('DNI', '41.234a567');

    expect((screen.getByLabelText('DNI') as HTMLInputElement).value).toBe('41234567');
  });

  it('no envía el formulario si hay datos inválidos y muestra los errores', async () => {
    simularApi([VENCIDA]);
    mostrar();
    await screen.findByText('Luis Gómez');

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));
    escribir('Nombre', 'A');
    escribir('DNI', '123456');
    escribir('Email', 'ana@');
    escribir('Contraseña inicial', 'corta');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(/al menos 2 caracteres/i)).toBeTruthy();
    expect(screen.getByText(/7 u 8 dígitos/i)).toBeTruthy();
    expect(screen.getByText(/email válido/i)).toBeTruthy();
    expect(screen.getByText(/debe tener al menos 8 caracteres/i)).toBeTruthy();
    expect(screen.getByText(/fecha de vencimiento es obligatoria/i)).toBeTruthy();
    expect(pedidosDe('POST')).toHaveLength(0);
  });

  it('muestra el error del servidor si el DNI o el email ya existen y deja el formulario abierto', async () => {
    simularApi([VENCIDA], (l) =>
      l.metodo === 'POST' ? respuesta(409, { detail: 'Ya existe un usuario con ese DNI.' }) : undefined
    );
    mostrar();
    await screen.findByText('Luis Gómez');

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));
    completarFormulario();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Ya existe un usuario con ese DNI.')).toBeTruthy();
    // los datos escritos se conservan para corregirlos
    expect((screen.getByLabelText('DNI') as HTMLInputElement).value).toBe('41234567');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
    expect(screen.queryByText('Socio creado.')).toBeNull();
  });

  it('cancelar cierra el formulario sin enviar nada', async () => {
    simularApi([VENCIDA]);
    mostrar();
    await screen.findByText('Luis Gómez');

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByLabelText('DNI')).toBeNull();
    expect(pedidosDe('POST')).toHaveLength(0);
  });
});

const DE_BAJA: Socio = {
  id: 'id-eva',
  nombre: 'Eva Ruiz',
  dni: '28999888',
  email: 'eva@correo.com',
  membresia_vence: '2026-12-31',
  membresia_vigente: false,
  activo: false,
};

/** Fecha AAAA-MM-DD a `dias` de hoy, con la fecha local (la misma que usa la pantalla). */
function diasDesdeHoy(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function fila(nombre: string) {
  return screen.getByText(nombre).closest('tr') as HTMLElement;
}

function listadosConsultados() {
  return pedidosDe('GET').map((l) => new URL(l.url).search);
}

describe('Pantalla de socios: búsqueda, filtros, edición, renovación y baja (Issue 20.3)', () => {
  beforeEach(() => {
    llamadas = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // --- Estado de la membresía ---

  it('muestra el estado de cada socio: vigente, vencida o de baja', async () => {
    simularApi([VIGENTE, VENCIDA, DE_BAJA]);
    mostrar();
    await screen.findByText('Ana Pérez');

    expect(within(fila('Ana Pérez')).getByText('Vigente')).toBeTruthy();
    expect(within(fila('Luis Gómez')).getByText('Vencida')).toBeTruthy();
    expect(within(fila('Eva Ruiz')).getByText('De baja')).toBeTruthy();
  });

  it('un dado de baja figura de baja aunque su fecha esté al día', async () => {
    simularApi([{ ...DE_BAJA, membresia_vigente: true }]);
    mostrar();
    await screen.findByText('Eva Ruiz');

    expect(within(fila('Eva Ruiz')).getByText('De baja')).toBeTruthy();
    expect(within(fila('Eva Ruiz')).queryByText('Vigente')).toBeNull();
  });

  it('a un dado de baja se le ofrece reactivar en vez de renovar o dar de baja', async () => {
    simularApi([VIGENTE, DE_BAJA]);
    mostrar();
    await screen.findByText('Eva Ruiz');

    expect(screen.getByRole('button', { name: 'Reactivar Eva Ruiz' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Renovar Eva Ruiz' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dar de baja a Eva Ruiz' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Renovar Ana Pérez' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reactivar Ana Pérez' })).toBeNull();
  });

  // --- Búsqueda y filtros ---

  it('busca mientras se escribe, con un solo pedido al dejar de escribir', async () => {
    simularApi([VIGENTE, VENCIDA]);
    mostrar();
    await screen.findByText('Ana Pérez');

    escribir('Buscar por DNI o nombre', 'p');
    escribir('Buscar por DNI o nombre', 'pé');
    escribir('Buscar por DNI o nombre', 'pérez');

    await waitFor(() => expect(listadosConsultados()).toContain('?buscar=p%C3%A9rez'));
    expect(listadosConsultados()).toEqual(['', '?buscar=p%C3%A9rez']);
  });

  it('el filtro de estado se aplica enseguida', async () => {
    simularApi([VIGENTE, VENCIDA]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.change(screen.getByLabelText('Estado de la membresía'), { target: { value: 'vencida' } });

    await waitFor(() => expect(listadosConsultados()).toContain('?estado=vencida'));
  });

  it.each([
    ['vigente', 'Vigente'],
    ['vencida', 'Vencida'],
    ['baja', 'De baja'],
  ])('ofrece el filtro "%s"', async (valor, etiqueta) => {
    simularApi([]);
    mostrar();
    await screen.findByText(/todavía no hay socios/i);

    const opcion = within(screen.getByLabelText('Estado de la membresía')).getByRole('option', {
      name: etiqueta,
    }) as HTMLOptionElement;
    expect(opcion.value).toBe(valor);
  });

  it('combina la búsqueda con el filtro de estado y muestra lo que devuelve el backend', async () => {
    simularApi([VIGENTE, VENCIDA, DE_BAJA], (l) =>
      l.metodo === 'GET' && l.url.includes('estado=baja') ? respuesta(200, [DE_BAJA]) : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.change(screen.getByLabelText('Estado de la membresía'), { target: { value: 'baja' } });
    escribir('Buscar por DNI o nombre', '  28999 ');

    await waitFor(() => expect(listadosConsultados()).toContain('?buscar=28999&estado=baja'));
    await waitFor(() => expect(screen.queryByText('Ana Pérez')).toBeNull());
    expect(screen.getByText('Eva Ruiz')).toBeTruthy();
  });

  it('sin resultados para la búsqueda lo dice y permite limpiar los filtros', async () => {
    simularApi([VIGENTE], (l) => (l.metodo === 'GET' && l.url.includes('?') ? respuesta(200, []) : undefined));
    mostrar();
    await screen.findByText('Ana Pérez');

    escribir('Buscar por DNI o nombre', 'zzz');

    expect(await screen.findByText('Ningún socio coincide con la búsqueda.')).toBeTruthy();
    expect(screen.queryByText(/todavía no hay socios/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    expect((screen.getByLabelText('Buscar por DNI o nombre') as HTMLInputElement).value).toBe('');
    expect(listadosConsultados().at(-1)).toBe('');
  });

  it('si una respuesta vieja llega tarde, se muestra la de la última búsqueda', async () => {
    let resolverVieja: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        llamadas.push({ url, metodo: 'GET', headers: {}, cuerpo: null });
        if (url.includes('estado=vigente')) {
          return new Promise<Response>((resolver) => {
            resolverVieja = resolver;
          });
        }
        if (url.includes('estado=baja')) return Promise.resolve(respuesta(200, [DE_BAJA]));
        return Promise.resolve(respuesta(200, [VIGENTE, VENCIDA, DE_BAJA]));
      })
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    const estado = screen.getByLabelText('Estado de la membresía');
    fireEvent.change(estado, { target: { value: 'vigente' } });
    await waitFor(() => expect(listadosConsultados()).toContain('?estado=vigente'));
    fireEvent.change(estado, { target: { value: 'baja' } });
    await waitFor(() => expect(screen.queryByText('Ana Pérez')).toBeNull());

    resolverVieja(respuesta(200, [VIGENTE]));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText('Eva Ruiz')).toBeTruthy();
    expect(screen.queryByText('Ana Pérez')).toBeNull();
  });

  it('un error al filtrar se muestra con opción de reintentar', async () => {
    simularApi([VIGENTE], (l) =>
      l.metodo === 'GET' && l.url.includes('estado=') ? respuesta(500, { detail: 'Error interno' }) : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.change(screen.getByLabelText('Estado de la membresía'), { target: { value: 'vencida' } });

    expect(await screen.findByText('Error interno')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();
  });

  // --- Edición ---

  it('edita un socio enviando solo los campos que cambiaron', async () => {
    simularApi([VIGENTE], (l) => (l.metodo === 'PUT' ? respuesta(200, { ...VIGENTE, nombre: 'Ana María Pérez' }) : undefined));
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Ana Pérez' }));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Ana Pérez');
    expect((screen.getByLabelText('DNI') as HTMLInputElement).value).toBe('41234567');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ana@correo.com');

    escribir('Nombre', 'Ana María Pérez');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(pedidosDe('PUT')).toHaveLength(1));
    expect(pedidosDe('PUT')[0].url).toMatch(/\/admin\/socios\/id-ana$/);
    expect(pedidosDe('PUT')[0].cuerpo).toEqual({ nombre: 'Ana María Pérez' });
    expect(await screen.findByText('Datos del socio actualizados.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
    expect(pedidosDe('GET').length).toBeGreaterThan(1);
  });

  it('guardar sin cambios cierra la edición sin pedirle nada al backend', async () => {
    simularApi([VIGENTE]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull());
    expect(pedidosDe('PUT')).toHaveLength(0);
  });

  it('no envía la edición con datos inválidos', async () => {
    simularApi([VIGENTE]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Ana Pérez' }));
    escribir('Nombre', 'A');
    escribir('DNI', '123');
    escribir('Email', 'ana@');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText(/al menos 2 caracteres/i)).toBeTruthy();
    expect(screen.getByText(/7 u 8 dígitos/i)).toBeTruthy();
    expect(screen.getByText(/email válido/i)).toBeTruthy();
    expect(pedidosDe('PUT')).toHaveLength(0);
  });

  it('si el DNI ya lo usa otro usuario, muestra el error y deja la edición abierta', async () => {
    simularApi([VIGENTE], (l) =>
      l.metodo === 'PUT' ? respuesta(409, { detail: 'Ya existe un usuario con ese DNI.' }) : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Ana Pérez' }));
    escribir('DNI', '30111222');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Ya existe un usuario con ese DNI.')).toBeTruthy();
    expect((screen.getByLabelText('DNI') as HTMLInputElement).value).toBe('30111222');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeTruthy();
  });

  it('cancelar la edición no envía nada', async () => {
    simularApi([VIGENTE]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
    expect(pedidosDe('PUT')).toHaveLength(0);
  });

  // --- Renovación ---

  it('renueva la membresía proponiendo un año más desde el vencimiento actual', async () => {
    const vence = diasDesdeHoy(30);
    const socio = { ...VIGENTE, membresia_vence: vence };
    simularApi([socio], (l) => (l.url.endsWith('/renovar') ? respuesta(200, socio) : undefined));
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Renovar Ana Pérez' }));
    const campo = screen.getByLabelText('Nuevo vencimiento') as HTMLInputElement;
    const [anio, resto] = [Number(vence.slice(0, 4)), vence.slice(4)];
    expect(campo.value).toBe(`${anio + 1}${resto}`);

    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));

    await waitFor(() => expect(pedidosDe('POST')).toHaveLength(1));
    expect(pedidosDe('POST')[0].url).toMatch(/\/admin\/socios\/id-ana\/renovar$/);
    expect(pedidosDe('POST')[0].cuerpo).toEqual({ membresia_vence: campo.value });
    expect(await screen.findByText('Membresía renovada.')).toBeTruthy();
  });

  it('a un socio vencido le propone un año desde hoy', async () => {
    simularApi([VENCIDA]);
    mostrar();
    await screen.findByText('Luis Gómez');

    fireEvent.click(screen.getByRole('button', { name: 'Renovar Luis Gómez' }));

    const hoy = diasDesdeHoy(0);
    const esperado = `${Number(hoy.slice(0, 4)) + 1}${hoy.slice(4)}`;
    // El 29/2 no existe el año siguiente: en ese caso se propone el 1/3
    if (!hoy.endsWith('-02-29')) {
      expect((screen.getByLabelText('Nuevo vencimiento') as HTMLInputElement).value).toBe(esperado);
    }
  });

  it('no envía una renovación con una fecha pasada', async () => {
    simularApi([VENCIDA]);
    mostrar();
    await screen.findByText('Luis Gómez');

    fireEvent.click(screen.getByRole('button', { name: 'Renovar Luis Gómez' }));
    escribir('Nuevo vencimiento', diasDesdeHoy(-1));
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));

    expect(await screen.findByText(/no puede ser anterior a hoy/i)).toBeTruthy();
    expect(pedidosDe('POST')).toHaveLength(0);
  });

  it('muestra el error del backend al renovar y deja el formulario abierto', async () => {
    simularApi([VIGENTE], (l) =>
      l.url.endsWith('/renovar')
        ? respuesta(409, { detail: 'El socio está dado de baja. Reactivalo antes de renovar la membresía.' })
        : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Renovar Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));

    expect(await screen.findByText(/reactivalo antes de renovar/i)).toBeTruthy();
    expect(screen.getByLabelText('Nuevo vencimiento')).toBeTruthy();
  });

  // --- Baja ---

  it('la baja pide confirmación antes de enviarse', async () => {
    simularApi([VIGENTE]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' }));

    const confirmacion = screen.getByRole('group', { name: 'Confirmar baja de Ana Pérez' });
    expect(within(confirmacion).getByText(/no va a poder iniciar sesión/i)).toBeTruthy();
    expect(pedidosDe('POST')).toHaveLength(0);
  });

  it('cancelar la confirmación no da de baja', async () => {
    simularApi([VIGENTE]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' }));
    fireEvent.click(within(fila('Ana Pérez')).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('group', { name: /confirmar baja/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' })).toBeTruthy();
    expect(pedidosDe('POST')).toHaveLength(0);
  });

  it('al confirmar da de baja, avisa y vuelve a pedir la lista', async () => {
    let dadoDeBaja = false;
    simularApi([], (l) => {
      if (l.url.endsWith('/baja')) {
        dadoDeBaja = true;
        return respuesta(200, { ...VIGENTE, activo: false });
      }
      if (l.metodo === 'GET') return respuesta(200, [dadoDeBaja ? { ...VIGENTE, activo: false } : VIGENTE]);
      return undefined;
    });
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }));

    await waitFor(() => expect(pedidosDe('POST')).toHaveLength(1));
    expect(pedidosDe('POST')[0].url).toMatch(/\/admin\/socios\/id-ana\/baja$/);
    expect(pedidosDe('POST')[0].cuerpo).toBeNull();
    expect(await screen.findByText('Ana Pérez fue dado de baja.')).toBeTruthy();
    await waitFor(() => expect(within(fila('Ana Pérez')).getByText('De baja')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reactivar Ana Pérez' })).toBeTruthy();
  });

  it('si la baja falla, muestra el error y el socio sigue igual', async () => {
    simularApi([VIGENTE], (l) =>
      l.url.endsWith('/baja') ? respuesta(409, { detail: 'El socio ya está dado de baja.' }) : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }));

    expect(await screen.findByText('El socio ya está dado de baja.')).toBeTruthy();
    expect(within(fila('Ana Pérez')).getByText('Vigente')).toBeTruthy();
    expect(screen.queryByText(/fue dado de baja/)).toBeNull();
  });

  it('mientras se procesa la baja los botones quedan deshabilitados', async () => {
    let terminar: (r: Response) => void = () => {};
    simularApi([VIGENTE], (l) =>
      l.url.endsWith('/baja')
        ? (new Promise<Response>((resolver) => {
            terminar = resolver;
          }) as unknown as Response)
        : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }));

    const enCurso = await screen.findByRole('button', { name: 'Dando de baja…' });
    expect((enCurso as HTMLButtonElement).disabled).toBe(true);
    terminar(respuesta(200, { ...VIGENTE, activo: false }));
    expect(await screen.findByText('Ana Pérez fue dado de baja.')).toBeTruthy();
  });

  it('una sesión vencida al dar de baja emite el evento de sesión vencida', async () => {
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    simularApi([VIGENTE], (l) =>
      l.url.endsWith('/baja') ? respuesta(401, { detail: 'No se pudieron validar las credenciales' }) : undefined
    );
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja a Ana Pérez' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }));

    await waitFor(() => expect(escuchador).toHaveBeenCalled());
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });

  // --- Reactivación ---

  it('reactiva a un socio dado de baja', async () => {
    simularApi([DE_BAJA], (l) => (l.url.endsWith('/reactivar') ? respuesta(200, { ...DE_BAJA, activo: true }) : undefined));
    mostrar();
    await screen.findByText('Eva Ruiz');

    fireEvent.click(screen.getByRole('button', { name: 'Reactivar Eva Ruiz' }));

    await waitFor(() => expect(pedidosDe('POST')).toHaveLength(1));
    expect(pedidosDe('POST')[0].url).toMatch(/\/admin\/socios\/id-eva\/reactivar$/);
    expect(await screen.findByText('Eva Ruiz fue reactivado.')).toBeTruthy();
  });

  // --- El alta se mantiene ---

  it('abrir otra acción reemplaza el formulario abierto', async () => {
    simularApi([VIGENTE]);
    mostrar();
    await screen.findByText('Ana Pérez');

    fireEvent.click(screen.getByRole('button', { name: /nuevo socio/i }));
    expect(screen.getByLabelText('Contraseña inicial')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Editar Ana Pérez' }));

    expect(screen.queryByLabelText('Contraseña inicial')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /nuevo socio/i })).toBeTruthy();
  });
});
