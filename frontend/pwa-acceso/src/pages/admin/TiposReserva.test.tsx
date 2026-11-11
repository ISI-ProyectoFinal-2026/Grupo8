// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_EXPIRED_EVENT,
  AuthProvider,
  TOKEN_KEY,
} from '@/context/AuthContext';
import type { TipoReservaAdmin } from '@/lib/tiposReserva';
import TiposReserva from './TiposReserva';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({
    sub: 'admin-1',
    rol: 'ADMIN',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

const CARPA: TipoReservaAdmin = {
  id: 't-carpa',
  nombre: 'Carpa',
  precio: 5000,
  forma_cobro: 'POR_PERSONA',
  max_personas: 10,
  cantidad_unidades: null,
  activo: true,
};
const CABANA: TipoReservaAdmin = {
  id: 't-cabana',
  nombre: 'Cabaña',
  precio: 25000,
  forma_cobro: 'POR_UNIDAD',
  max_personas: 6,
  cantidad_unidades: 4,
  activo: true,
};
const DOMO_INACTIVO: TipoReservaAdmin = {
  id: 't-domo',
  nombre: 'Domo',
  precio: 12000,
  forma_cobro: 'POR_UNIDAD',
  max_personas: 2,
  cantidad_unidades: null,
  activo: false,
};

interface Llamada {
  url: string;
  metodo: string;
  cuerpo: Record<string, unknown> | null;
}

let llamadas: Llamada[];

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

/** El GET devuelve `tipos`; POST y PUT responden lo que diga `alGuardar` (o 200 con lo enviado). */
function simularApi(
  tipos: TipoReservaAdmin[] | 'error',
  alGuardar?: () => Response
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const llamada: Llamada = {
        url,
        metodo: init?.method ?? 'GET',
        cuerpo: init?.body ? JSON.parse(String(init.body)) : null,
      };
      llamadas.push(llamada);
      if (llamada.metodo === 'GET')
        return tipos === 'error'
          ? respuesta(500, { detail: 'Error interno' })
          : respuesta(200, tipos);
      return alGuardar?.() ?? respuesta(200, { ...CARPA, ...llamada.cuerpo });
    })
  );
}

const pedidos = (metodo: string) => llamadas.filter((l) => l.metodo === metodo);

function mostrar() {
  return render(
    <AuthProvider>
      <TiposReserva />
    </AuthProvider>
  );
}

const escribir = (etiqueta: RegExp, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), {
    target: { value: valor },
  });

describe('Panel: Tipos de reserva (Issue 19.4)', () => {
  beforeEach(() => {
    llamadas = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('muestra un aviso mientras carga', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    mostrar();

    expect(screen.getByText('Cargando tipos de reserva…')).toBeTruthy();
  });

  it('lista todos los tipos, también los inactivos, con precio, máximo y unidades', async () => {
    simularApi([CARPA, CABANA, DOMO_INACTIVO]);

    mostrar();

    const filaCabana = (await screen.findByText('Cabaña')).closest('tr')!;
    expect(within(filaCabana).getByText('$25.000 por noche')).toBeTruthy();
    expect(within(filaCabana).getByText('6')).toBeTruthy();
    expect(within(filaCabana).getByText('4')).toBeTruthy();
    const filaCarpa = screen.getByText('Carpa').closest('tr')!;
    expect(within(filaCarpa).getByText('$5.000 por persona')).toBeTruthy();
    expect(within(filaCarpa).getByText('—')).toBeTruthy();
    const filaDomo = screen.getByText('Domo').closest('tr')!;
    expect(within(filaDomo).getByText('Sin límite')).toBeTruthy();
    expect(within(filaDomo).getByText('Inactivo')).toBeTruthy();
    expect(pedidos('GET')[0].url).toMatch(/\/api\/v1\/admin\/tipos-reserva$/);
  });

  it('sin tipos muestra el estado vacío', async () => {
    simularApi([]);

    mostrar();

    expect(
      await screen.findByText('Todavía no hay tipos de reserva cargados.')
    ).toBeTruthy();
  });

  it('si falla la carga muestra el error y permite reintentar', async () => {
    simularApi('error');

    mostrar();

    expect(await screen.findByText('Error interno')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(pedidos('GET')).toHaveLength(2));
  });

  it('crea un tipo por unidad con sus unidades', async () => {
    simularApi([CARPA]);
    mostrar();
    await screen.findByText('Carpa');

    fireEvent.click(screen.getByRole('button', { name: /Nuevo tipo/ }));
    escribir(/^Nombre$/, 'Domo');
    fireEvent.change(screen.getByLabelText('Forma de cobro'), {
      target: { value: 'POR_UNIDAD' },
    });
    escribir(/Precio por noche/, '12000');
    escribir(/Máximo de personas/, '2');
    escribir(/Cantidad de unidades/, '3');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Tipo de reserva creado.')).toBeTruthy();
    expect(pedidos('POST')[0].cuerpo).toEqual({
      nombre: 'Domo',
      precio: 12000,
      forma_cobro: 'POR_UNIDAD',
      max_personas: 2,
      cantidad_unidades: 3,
      activo: true,
    });
    // Se vuelve a pedir la lista para mostrar el tipo nuevo
    expect(pedidos('GET')).toHaveLength(2);
  });

  it('las unidades solo se piden en los tipos por unidad', async () => {
    simularApi([]);
    mostrar();
    await screen.findByText('Todavía no hay tipos de reserva cargados.');

    fireEvent.click(screen.getByRole('button', { name: /Nuevo tipo/ }));

    expect(screen.queryByLabelText(/Cantidad de unidades/)).toBeNull();
    expect(screen.getByLabelText(/Precio por persona/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Forma de cobro'), {
      target: { value: 'POR_UNIDAD' },
    });
    expect(screen.getByLabelText(/Cantidad de unidades/)).toBeTruthy();
  });

  it('no envía nada si el formulario es inválido', async () => {
    simularApi([]);
    mostrar();
    await screen.findByText('Todavía no hay tipos de reserva cargados.');

    fireEvent.click(screen.getByRole('button', { name: /Nuevo tipo/ }));
    escribir(/Precio por persona/, '0');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('El nombre es obligatorio.')).toBeTruthy();
    expect(screen.getByText('El precio tiene que ser mayor a 0.')).toBeTruthy();
    expect(
      screen.getByText('El máximo de personas es obligatorio.')
    ).toBeTruthy();
    expect(pedidos('POST')).toHaveLength(0);
  });

  it('muestra el error del backend (nombre repetido) y deja el formulario abierto', async () => {
    simularApi([CARPA], () =>
      respuesta(409, { detail: 'Ya existe un tipo de reserva con ese nombre.' })
    );
    mostrar();
    await screen.findByText('Carpa');

    fireEvent.click(screen.getByRole('button', { name: /Nuevo tipo/ }));
    escribir(/^Nombre$/, 'carpa');
    escribir(/Precio por persona/, '5000');
    escribir(/Máximo de personas/, '4');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Ya existe un tipo de reserva con ese nombre.')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
  });

  it('muestra el error del backend cuando supera el máximo general', async () => {
    simularApi([CARPA], () =>
      respuesta(422, {
        detail:
          'El máximo de personas no puede superar el máximo general por reserva (10).',
      })
    );
    mostrar();
    await screen.findByText('Carpa');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Carpa' }));
    escribir(/Máximo de personas/, '12');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText(
        /no puede superar el máximo general por reserva \(10\)/
      )
    ).toBeTruthy();
  });

  it('edita un tipo con los valores cargados', async () => {
    simularApi([CABANA]);
    mostrar();
    await screen.findByText('Cabaña');

    fireEvent.click(screen.getByRole('button', { name: 'Editar Cabaña' }));
    expect(
      (screen.getByLabelText(/Precio por noche/) as HTMLInputElement).value
    ).toBe('25000');
    expect(
      (screen.getByLabelText(/Cantidad de unidades/) as HTMLInputElement).value
    ).toBe('4');
    escribir(/Precio por noche/, '27500');
    escribir(/Cantidad de unidades/, '');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Tipo de reserva actualizado.')
    ).toBeTruthy();
    const put = pedidos('PUT')[0];
    expect(put.url).toMatch(/\/api\/v1\/admin\/tipos-reserva\/t-cabana$/);
    expect(put.cuerpo).toMatchObject({
      precio: 27500,
      cantidad_unidades: null,
      forma_cobro: 'POR_UNIDAD',
    });
  });

  it('desactiva y activa sin borrar', async () => {
    simularApi([CARPA, DOMO_INACTIVO]);
    mostrar();
    await screen.findByText('Carpa');

    fireEvent.click(screen.getByRole('button', { name: 'Desactivar Carpa' }));
    expect(
      await screen.findByText('Tipo de reserva desactivado.')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Activar Domo' }));
    expect(await screen.findByText('Tipo de reserva activado.')).toBeTruthy();

    expect(
      pedidos('PUT').map((p) => [p.url.split('/').pop(), p.cuerpo])
    ).toEqual([
      ['t-carpa', { activo: false }],
      ['t-domo', { activo: true }],
    ]);
    expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
  });

  it('una respuesta 401 emite el evento de sesión vencida', async () => {
    const escuchador = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, escuchador);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(401, { detail: 'Token inválido' }))
    );

    mostrar();

    await waitFor(() => expect(escuchador).toHaveBeenCalled());
    window.removeEventListener(AUTH_EXPIRED_EVENT, escuchador);
  });
});
