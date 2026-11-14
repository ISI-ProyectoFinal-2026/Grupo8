// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_EVENT, AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { DetalleReserva, ReservaAdmin, ReservasPaginadas } from '@/lib/reservasAdmin';
import GestionReservas from './GestionReservas';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'admin-1', rol: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function reserva(numero: number, cambios: Partial<ReservaAdmin> = {}): ReservaAdmin {
  return {
    id: `${String(numero).padStart(8, '0')}-0000-4000-8000-000000000000`,
    titular: `Titular ${numero}`,
    email: `titular${numero}@correo.com`,
    telefono: null,
    tipo_cliente: 'visitante',
    fecha_reserva: '2026-11-10T15:00:00',
    fecha_ingreso: '2026-12-20',
    fecha_egreso: '2026-12-22',
    cantidad_personas: 3,
    monto_total: 45000,
    estado_reserva: 'Confirmada',
    estado_pago: 'Pagado',
    personas: [],
    ...cambios,
  };
}

const ANA = reserva(1, { titular: 'Ana Pérez', tipo_cliente: 'socio' });

const DETALLE_ANA: DetalleReserva = {
  ...ANA,
  tipo_reserva_nombre: 'Carpa',
  personas: [
    { nombre: 'Ana Pérez', edad: 34, condicion: 'socio', dni: '41234567', precio_base: 15000, descuento_pct: 10, precio_final: 13500 },
    { nombre: 'Luis Pérez', edad: 8, condicion: 'visitante', dni: null, precio_base: 15000, descuento_pct: 0, precio_final: 15000 },
  ],
  pagos: [
    {
      id: 'pago-1',
      mp_payment_id: '123456789',
      estado: 'approved',
      monto: 45000,
      metodo_pago: 'account_money',
      fecha_creacion: '2026-11-10T15:05:00+00:00',
      fecha_aprobacion: '2026-11-10T15:06:00+00:00',
      monto_devuelto: null,
      devolucion_estado: null,
    },
  ],
  ya_ingreso: false,
  fecha_primer_ingreso: null,
};

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

let urls: string[];

/** Simula el backend: el listado y el detalle se contestan por separado. */
function simularApi(
  listado: ReservasPaginadas | ((url: string) => Response),
  detalle: Response = respuesta(200, DETALLE_ANA)
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const esListado = /\/reservas\/\?/.test(url);
      if (!esListado) return detalle;
      return typeof listado === 'function' ? listado(url) : respuesta(200, listado);
    })
  );
}

function consultasDelListado() {
  return urls
    .filter((url) => /\/reservas\/\?/.test(url))
    .map((url) => new URLSearchParams(url.split('?')[1]));
}

const ultimaConsulta = () => {
  const consultas = consultasDelListado();
  return consultas[consultas.length - 1];
};

function mostrar() {
  return render(
    <AuthProvider>
      <GestionReservas />
    </AuthProvider>
  );
}

describe('Gestión de reservas (Issue 23.3)', () => {
  beforeEach(() => {
    urls = [];
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('estados de la pantalla', () => {
    it('muestra "cargando" mientras espera la respuesta', () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

      mostrar();

      expect(screen.getByRole('heading', { level: 1, name: 'Gestión de reservas' })).toBeTruthy();
      expect(screen.getByText('Cargando reservas…')).toBeTruthy();
    });

    it('sin reservas lo dice', async () => {
      simularApi({ total: 0, items: [] });

      mostrar();

      expect(await screen.findByText('Todavía no hay reservas.')).toBeTruthy();
    });

    it('si los filtros no encuentran nada ofrece limpiarlos', async () => {
      simularApi((url) =>
        respuesta(200, url.includes('tipo_cliente') ? { total: 0, items: [] } : { total: 1, items: [ANA] })
      );
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.change(screen.getByLabelText('Tipo de cliente'), { target: { value: 'visitante' } });
      expect(await screen.findByText('Ninguna reserva coincide con los filtros.')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
      expect(await screen.findByText('Ana Pérez')).toBeTruthy();
      expect(ultimaConsulta().get('tipo_cliente')).toBeNull();
    });

    it('muestra el error y permite reintentar', async () => {
      let intentos = 0;
      simularApi(() => {
        intentos += 1;
        return intentos === 1
          ? respuesta(500, { detail: 'Error interno' })
          : respuesta(200, { total: 1, items: [ANA] });
      });

      mostrar();

      expect((await screen.findByRole('alert')).textContent).toBe('Error interno');
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    });

    it('una sesión vencida avisa a la app para cerrarla', async () => {
      const escucha = vi.fn();
      window.addEventListener(AUTH_EXPIRED_EVENT, escucha);
      simularApi(() => respuesta(401, { detail: 'Token inválido' }));

      mostrar();

      await waitFor(() => expect(escucha).toHaveBeenCalled());
      window.removeEventListener(AUTH_EXPIRED_EVENT, escucha);
    });
  });

  it('la tabla muestra número, titular, tipo de cliente, fechas, personas, monto y estado', async () => {
    simularApi({ total: 1, items: [ANA] });

    mostrar();

    const fila = (await screen.findByText('Ana Pérez')).closest('tr')!;
    const celdas = within(fila);
    expect(celdas.getByText('#00000001')).toBeTruthy();
    expect(celdas.getByText('Socio')).toBeTruthy();
    expect(celdas.getByText('20/12/2026 al 22/12/2026')).toBeTruthy();
    expect(celdas.getByText('3')).toBeTruthy();
    expect(celdas.getByText('$45.000')).toBeTruthy();
    expect(celdas.getByText('Confirmada')).toBeTruthy();
    expect(celdas.getByText('Pago: Pagado')).toBeTruthy();
  });

  describe('filtros', () => {
    it('manda el estado, el tipo de cliente y las fechas y vuelve a la primera página', async () => {
      simularApi({ total: 1, items: [ANA] });
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'Cancelada' } });
      fireEvent.change(screen.getByLabelText('Tipo de cliente'), { target: { value: 'socio' } });
      fireEvent.change(screen.getByLabelText('Ingreso desde'), { target: { value: '2026-12-01' } });
      fireEvent.change(screen.getByLabelText('Ingreso hasta'), { target: { value: '2026-12-31' } });

      await waitFor(() => expect(ultimaConsulta().get('fecha_hasta')).toBe('2026-12-31'));
      const consulta = ultimaConsulta();
      expect(consulta.get('estado_reserva')).toBe('Cancelada');
      expect(consulta.get('tipo_cliente')).toBe('socio');
      expect(consulta.get('fecha_desde')).toBe('2026-12-01');
      expect(consulta.get('skip')).toBe('0');
    });

    it('busca por titular, email o número cuando se deja de escribir', async () => {
      simularApi({ total: 1, items: [ANA] });
      mostrar();
      await screen.findByText('Ana Pérez');
      const pedidosAntes = consultasDelListado().length;

      fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'An' } });
      fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Ana' } });

      await waitFor(() => expect(ultimaConsulta().get('busqueda')).toBe('Ana'));
      // Las letras intermedias no generan un pedido cada una
      expect(consultasDelListado().length).toBe(pedidosAntes + 1);
    });

    it('con un rango de fechas al revés avisa y no consulta', async () => {
      simularApi({ total: 1, items: [ANA] });
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.change(screen.getByLabelText('Ingreso desde'), { target: { value: '2026-12-10' } });
      await waitFor(() => expect(ultimaConsulta().get('fecha_desde')).toBe('2026-12-10'));
      const pedidosAntes = consultasDelListado().length;

      fireEvent.change(screen.getByLabelText('Ingreso hasta'), { target: { value: '2026-12-01' } });

      expect(await screen.findByText(/no puede ser anterior/)).toBeTruthy();
      expect(consultasDelListado().length).toBe(pedidosAntes);
    });
  });

  it('pagina con el total que devuelve el backend', async () => {
    const pagina1 = Array.from({ length: 20 }, (_, i) => reserva(i + 1));
    const pagina2 = Array.from({ length: 5 }, (_, i) => reserva(i + 21));
    simularApi((url) =>
      respuesta(200, url.includes('skip=20') ? { total: 25, items: pagina2 } : { total: 25, items: pagina1 })
    );

    mostrar();

    expect(await screen.findByText('Mostrando 1–20 de 25')).toBeTruthy();
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(await screen.findByText('Mostrando 21–25 de 25')).toBeTruthy();
    expect(ultimaConsulta().get('skip')).toBe('20');
    expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe('detalle', () => {
    it('"Ver detalle" abre una ventana con personas, tipo, pagos y si ya ingresó', async () => {
      simularApi({ total: 1, items: [ANA] });
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

      const ventana = await screen.findByRole('dialog');
      expect(within(ventana).getByText('Reserva #00000001')).toBeTruthy();
      expect(await within(ventana).findByText('Carpa')).toBeTruthy();
      expect(within(ventana).getByText('Luis Pérez')).toBeTruthy();
      expect(within(ventana).getByText('41234567')).toBeTruthy();
      expect(within(ventana).getByText('Aprobado')).toBeTruthy();
      expect(within(ventana).getByText('Todavía no ingresó')).toBeTruthy();
      expect(urls.some((url) => url.endsWith(`/reservas/${ANA.id}`))).toBe(true);
    });

    it('indica cuándo ingresó la reserva', async () => {
      simularApi(
        { total: 1, items: [ANA] },
        respuesta(200, { ...DETALLE_ANA, ya_ingreso: true, fecha_primer_ingreso: '2026-12-20T13:00:00+00:00' })
      );
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

      expect(await screen.findByText(/^Ingresó el /)).toBeTruthy();
    });

    it('si el detalle falla lo muestra en la ventana', async () => {
      simularApi({ total: 1, items: [ANA] }, respuesta(404, { detail: 'La reserva no existe.' }));
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

      const ventana = await screen.findByRole('dialog');
      expect(await within(ventana).findByText('La reserva no existe.')).toBeTruthy();
    });

    it('"Cerrar" cierra la ventana', async () => {
      simularApi({ total: 1, items: [ANA] });
      mostrar();
      await screen.findByText('Ana Pérez');

      fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
