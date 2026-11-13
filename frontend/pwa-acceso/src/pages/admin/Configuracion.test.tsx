// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_EXPIRED_EVENT,
  AuthProvider,
  TOKEN_KEY,
} from '@/context/AuthContext';
import type { ConfiguracionCamping } from '@/lib/configuracion';
import Configuracion from './Configuracion';

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

const GUARDADA: ConfiguracionCamping = {
  capacidad_total: 50,
  porcentaje_buffer_offline: 10,
  max_personas_por_reserva: 10,
  dias_cancelacion: 1,
  porcentaje_devolucion: 100,
  porcentaje_buffer_recomendado: 20,
};

interface LlamadaFetch {
  url: string;
  metodo: string;
  headers: Record<string, string>;
  cuerpo: Record<string, unknown> | null;
}

let llamadas: LlamadaFetch[];

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

/** Simula el backend: el GET devuelve `config` y el PUT devuelve lo que se envió (o lo que diga `alGuardar`). */
function simularApi(config: ConfiguracionCamping, alGuardar?: () => Response) {
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
      if (llamada.metodo === 'GET') return respuesta(200, config);
      return (
        alGuardar?.() ??
        respuesta(200, { ...llamada.cuerpo, porcentaje_buffer_recomendado: 20 })
      );
    })
  );
}

function pedidosDe(metodo: string) {
  return llamadas.filter((l) => l.metodo === metodo);
}

function mostrar() {
  return render(
    <AuthProvider>
      <Configuracion />
    </AuthProvider>
  );
}

function escribir(etiqueta: RegExp, valor: string) {
  fireEvent.change(screen.getByLabelText(etiqueta), {
    target: { value: valor },
  });
}

function campo(etiqueta: RegExp) {
  return screen.getByLabelText(etiqueta) as HTMLInputElement;
}

describe('Pantalla de configuración del camping (Issue 19.1)', () => {
  beforeEach(() => {
    llamadas = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('muestra la configuración guardada pedida con el token del administrador', async () => {
    simularApi({
      ...GUARDADA,
      capacidad_total: 80,
      porcentaje_buffer_offline: 20,
      max_personas_por_reserva: 6,
    });

    mostrar();

    await waitFor(() => expect(campo(/cupo máximo/i).value).toBe('80'));
    expect(campo(/buffer offline/i).value).toBe('20');
    expect(campo(/máximo de personas/i).value).toBe('6');
    const pedido = pedidosDe('GET')[0];
    expect(pedido.url).toMatch(/\/api\/v1\/admin\/configuracion$/);
    expect(pedido.headers.Authorization).toBe(
      `Bearer ${localStorage.getItem(TOKEN_KEY)}`
    );
  });

  it('sugiere el buffer recomendado y permite usarlo', async () => {
    simularApi({ ...GUARDADA, porcentaje_buffer_offline: 25 });
    mostrar();
    await waitFor(() => expect(campo(/buffer offline/i).value).toBe('25'));

    expect(screen.getByText(/recomendado: 20 %/i)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: /usar el recomendado/i })
    );

    expect(campo(/buffer offline/i).value).toBe('20');
    expect(
      screen.queryByRole('button', { name: /usar el recomendado/i })
    ).toBeNull();
  });

  it('muestra cuántos lugares se venden online y cuántos quedan para la puerta', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cupo máximo/i).value).toBe('50'));

    expect(screen.getByText(/se venden online/i).textContent).toBe(
      'Se venden online 45 lugares y 5 quedan para la puerta.'
    );

    escribir(/cupo máximo/i, '45');
    // 10 % de 45 = 4,5: se guardan 5 lugares
    expect(screen.getByText(/se venden online/i).textContent).toBe(
      'Se venden online 40 lugares y 5 quedan para la puerta.'
    );
  });

  it('guarda todos los valores como números y avisa', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cupo máximo/i).value).toBe('50'));

    escribir(/cupo máximo/i, '80');
    escribir(/buffer offline/i, '20');
    escribir(/máximo de personas/i, '6');
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    expect(await screen.findByText('Configuración guardada.')).toBeTruthy();
    expect(pedidosDe('PUT')[0].cuerpo).toEqual({
      capacidad_total: 80,
      porcentaje_buffer_offline: 20,
      max_personas_por_reserva: 6,
      dias_cancelacion: 1,
      porcentaje_devolucion: 100,
    });
  });

  it('no envía nada si el formulario es inválido', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cupo máximo/i).value).toBe('50'));

    escribir(/cupo máximo/i, '0');
    escribir(/buffer offline/i, '150');
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    expect(
      await screen.findByText('El cupo tiene que ser mayor a 0.')
    ).toBeTruthy();
    expect(
      screen.getByText('El buffer tiene que estar entre 0 % y 100 %.')
    ).toBeTruthy();
    expect(pedidosDe('PUT')).toHaveLength(0);
  });

  it('no deja un máximo mayor al cupo online', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cupo máximo/i).value).toBe('50'));

    escribir(/máximo de personas/i, '46');
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    expect(
      await screen.findByText(
        'El máximo no puede superar el cupo online (45 personas).'
      )
    ).toBeTruthy();
    expect(pedidosDe('PUT')).toHaveLength(0);
  });

  it('muestra el error que devuelve el backend', async () => {
    simularApi(GUARDADA, () =>
      respuesta(422, {
        detail: [
          {
            msg: 'Value error, El máximo de personas por reserva no puede superar el cupo online (45 personas: la capacidad menos el buffer).',
          },
        ],
      })
    );
    mostrar();
    await waitFor(() => expect(campo(/cupo máximo/i).value).toBe('50'));

    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    expect(
      await screen.findByText(
        /no puede superar el cupo online \(45 personas: la capacidad/
      )
    ).toBeTruthy();
    expect(screen.queryByText('Configuración guardada.')).toBeNull();
  });

  it('muestra un error con opción de reintentar si no se puede cargar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(500, { detail: 'Error interno' }))
    );

    mostrar();

    expect(await screen.findByText('Error interno')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();
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

describe('Reglas de cancelación en la pantalla de configuración (Issue 22.1)', () => {
  beforeEach(() => {
    llamadas = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('muestra el plazo y la devolución guardados con su resumen', async () => {
    simularApi({ ...GUARDADA, dias_cancelacion: 3, porcentaje_devolucion: 50 });

    mostrar();

    await waitFor(() => expect(campo(/cancelar hasta/i).value).toBe('3'));
    expect(campo(/devolución/i).value).toBe('50');
    expect(screen.getByText(/los socios pueden cancelar/i).textContent).toBe(
      'Los socios pueden cancelar hasta 3 días antes del ingreso y se les devuelve el 50 % de lo que pagaron.'
    );
  });

  it('con plazo 0 explica que se puede cancelar hasta el mismo día', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cancelar hasta/i).value).toBe('1'));

    expect(screen.getByText(/los socios pueden cancelar/i).textContent).toBe(
      'Los socios pueden cancelar hasta 1 día antes del ingreso y se les devuelve el 100 % de lo que pagaron.'
    );

    escribir(/cancelar hasta/i, '0');
    expect(screen.getByText(/los socios pueden cancelar/i).textContent).toBe(
      'Los socios pueden cancelar hasta el mismo día del ingreso y se les devuelve el 100 % de lo que pagaron.'
    );
  });

  it('guarda el plazo y la devolución editados junto con el resto', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cancelar hasta/i).value).toBe('1'));

    escribir(/cancelar hasta/i, '7');
    escribir(/devolución/i, '80');
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    expect(await screen.findByText('Configuración guardada.')).toBeTruthy();
    expect(pedidosDe('PUT')[0].cuerpo).toEqual({
      capacidad_total: 50,
      porcentaje_buffer_offline: 10,
      max_personas_por_reserva: 10,
      dias_cancelacion: 7,
      porcentaje_devolucion: 80,
    });
    expect(campo(/cancelar hasta/i).value).toBe('7');
    expect(campo(/devolución/i).value).toBe('80');
  });

  it('no envía nada si el plazo es negativo o la devolución pasa del 100 %', async () => {
    simularApi(GUARDADA);
    mostrar();
    await waitFor(() => expect(campo(/cancelar hasta/i).value).toBe('1'));

    escribir(/cancelar hasta/i, '-1');
    escribir(/devolución/i, '120');
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    expect(
      await screen.findByText(
        'El plazo tiene que ser un número entero de días, sin negativos.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText('La devolución tiene que estar entre 0 % y 100 %.')
    ).toBeTruthy();
    expect(screen.queryByText(/los socios pueden cancelar/i)).toBeNull();
    expect(pedidosDe('PUT')).toHaveLength(0);
  });
});
