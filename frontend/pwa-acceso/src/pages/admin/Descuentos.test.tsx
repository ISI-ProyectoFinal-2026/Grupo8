// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT, AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { Descuento } from '@/lib/descuentos';
import Descuentos from './Descuentos';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'admin-1', rol: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

const SOCIO: Descuento = {
  id: 'id-socio',
  codigo: 'socio',
  nombre: 'Descuento para socios',
  aplica_a: 'socio',
  porcentaje: 20,
  edad_min: null,
  edad_max: null,
  activo: true,
};

const MENORES: Descuento = {
  id: 'id-menores',
  codigo: 'menores',
  nombre: 'Menores de 12',
  aplica_a: 'edad',
  porcentaje: 50,
  edad_min: 0,
  edad_max: 12,
  activo: false,
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
function simularApi(lista: Descuento[], responder?: (llamada: LlamadaFetch) => Response | undefined) {
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
      return llamada.metodo === 'GET' ? respuesta(200, lista) : respuesta(200, lista[0]);
    })
  );
}

function pedidosDe(metodo: string) {
  return llamadas.filter((l) => l.metodo === metodo);
}

function mostrar() {
  return render(
    <AuthProvider>
      <Descuentos />
    </AuthProvider>
  );
}

function escribir(etiqueta: string | RegExp, valor: string) {
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
}

describe('Pantalla de descuentos (Issue 14.2)', () => {
  beforeEach(() => {
    llamadas = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lista los descuentos con el token del administrador', async () => {
    simularApi([SOCIO, MENORES]);

    mostrar();

    expect(await screen.findByText('Descuento para socios')).toBeTruthy();
    expect(screen.getByText('Menores de 12')).toBeTruthy();
    expect(screen.getByText('20 %')).toBeTruthy();
    expect(screen.getByText('De 0 a 12 años')).toBeTruthy();
    const listado = pedidosDe('GET')[0];
    expect(listado.url).toMatch(/\/admin\/descuentos$/);
    expect(listado.headers.Authorization).toBe(`Bearer ${localStorage.getItem(TOKEN_KEY)}`);
  });

  it('muestra un mensaje cuando no hay descuentos', async () => {
    simularApi([]);

    mostrar();

    expect(await screen.findByText(/todavía no hay descuentos/i)).toBeTruthy();
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

  it('crea un descuento por edad', async () => {
    simularApi([SOCIO]);
    mostrar();
    await screen.findByText('Descuento para socios');

    fireEvent.click(screen.getByRole('button', { name: /nuevo descuento/i }));
    escribir('Código', 'jubilados');
    escribir('Nombre', 'Jubilados');
    escribir(/porcentaje de descuento/i, '30,5');
    escribir('Edad mínima', '65');
    escribir('Edad máxima', '120');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(pedidosDe('POST')).toHaveLength(1));
    expect(pedidosDe('POST')[0].cuerpo).toEqual({
      codigo: 'jubilados',
      aplica_a: 'edad',
      nombre: 'Jubilados',
      porcentaje: 30.5,
      activo: true,
      edad_min: 65,
      edad_max: 120,
    });
    expect(await screen.findByText('Descuento creado.')).toBeTruthy();
    // se vuelve a pedir la lista
    expect(pedidosDe('GET').length).toBeGreaterThan(1);
  });

  it('un descuento para socios no pide edades', async () => {
    simularApi([]);
    mostrar();
    await screen.findByText(/todavía no hay descuentos/i);

    fireEvent.click(screen.getByRole('button', { name: /nuevo descuento/i }));
    expect(screen.getByLabelText('Edad mínima')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Aplica a'), { target: { value: 'socio' } });

    expect(screen.queryByLabelText('Edad mínima')).toBeNull();
    expect(screen.queryByLabelText('Edad máxima')).toBeNull();
  });

  it('no envía el formulario si hay valores inválidos y muestra los errores', async () => {
    simularApi([SOCIO]);
    mostrar();
    await screen.findByText('Descuento para socios');

    fireEvent.click(screen.getByRole('button', { name: /nuevo descuento/i }));
    escribir('Código', 'Código Inválido');
    escribir('Nombre', 'A');
    escribir(/porcentaje de descuento/i, '101');
    escribir('Edad mínima', '20');
    escribir('Edad máxima', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(/el código debe tener/i)).toBeTruthy();
    expect(screen.getByText(/al menos 2 caracteres/i)).toBeTruthy();
    expect(screen.getByText(/entre 0 y 100/i)).toBeTruthy();
    expect(screen.getByText(/mínima no puede ser mayor/i)).toBeTruthy();
    expect(pedidosDe('POST')).toHaveLength(0);
  });

  it('muestra el error del servidor si el código ya existe', async () => {
    simularApi([SOCIO], (l) =>
      l.metodo === 'POST' ? respuesta(409, { detail: 'Ya existe un descuento con ese código.' }) : undefined
    );
    mostrar();
    await screen.findByText('Descuento para socios');

    fireEvent.click(screen.getByRole('button', { name: /nuevo descuento/i }));
    escribir('Código', 'socio');
    escribir('Nombre', 'Otro socio');
    fireEvent.change(screen.getByLabelText('Aplica a'), { target: { value: 'socio' } });
    escribir(/porcentaje de descuento/i, '10');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Ya existe un descuento con ese código.')).toBeTruthy();
    // el formulario sigue abierto para corregir
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
  });

  it('edita un descuento sin permitir cambiar su código ni a quién aplica', async () => {
    simularApi([SOCIO, MENORES]);
    mostrar();
    await screen.findByText('Menores de 12');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Menores de 12' }));

    const codigo = screen.getByLabelText('Código') as HTMLInputElement;
    expect(codigo.value).toBe('menores');
    expect(codigo.disabled).toBe(true);
    expect((screen.getByLabelText('Aplica a') as HTMLSelectElement).disabled).toBe(true);

    escribir(/porcentaje de descuento/i, '45');
    escribir('Edad máxima', '14');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(pedidosDe('PUT')).toHaveLength(1));
    expect(pedidosDe('PUT')[0].url).toMatch(/\/admin\/descuentos\/id-menores$/);
    expect(pedidosDe('PUT')[0].cuerpo).toEqual({
      nombre: 'Menores de 12',
      porcentaje: 45,
      activo: false,
      edad_min: 0,
      edad_max: 14,
    });
    expect(await screen.findByText('Descuento actualizado.')).toBeTruthy();
  });

  it('desactiva y activa un descuento desde la lista', async () => {
    simularApi([SOCIO, MENORES]);
    mostrar();
    await screen.findByText('Descuento para socios');

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Descuento para socios' }));
    await waitFor(() => expect(pedidosDe('PUT')).toHaveLength(1));
    expect(pedidosDe('PUT')[0].url).toMatch(/\/admin\/descuentos\/id-socio$/);
    expect(pedidosDe('PUT')[0].cuerpo).toEqual({ activo: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Activar Menores de 12' }));
    await waitFor(() => expect(pedidosDe('PUT')).toHaveLength(2));
    expect(pedidosDe('PUT')[1].cuerpo).toEqual({ activo: true });
  });

  it('muestra el estado de cada descuento', async () => {
    simularApi([SOCIO, MENORES]);
    mostrar();

    const filaSocio = (await screen.findByText('Descuento para socios')).closest('tr') as HTMLElement;
    const filaMenores = screen.getByText('Menores de 12').closest('tr') as HTMLElement;

    expect(within(filaSocio).getByText('Activo')).toBeTruthy();
    expect(within(filaMenores).getByText('Inactivo')).toBeTruthy();
  });

  it('cancelar cierra el formulario sin enviar nada', async () => {
    simularApi([SOCIO]);
    mostrar();
    await screen.findByText('Descuento para socios');

    fireEvent.click(screen.getByRole('button', { name: /nuevo descuento/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByLabelText('Código')).toBeNull();
    expect(pedidosDe('POST')).toHaveLength(0);
  });
});
