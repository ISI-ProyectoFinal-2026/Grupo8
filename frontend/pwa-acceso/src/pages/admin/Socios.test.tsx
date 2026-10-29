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
};

const VENCIDA: Socio = {
  id: 'id-luis',
  nombre: 'Luis Gómez',
  dni: '30111222',
  email: 'luis@correo.com',
  membresia_vence: '2024-03-05',
  membresia_vigente: false,
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
