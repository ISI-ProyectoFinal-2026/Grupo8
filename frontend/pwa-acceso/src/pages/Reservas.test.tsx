// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import type { UsuarioSesion } from '@/lib/auth';
import type { Cotizacion } from '@/lib/cotizacion';
import type { ValidacionSocio } from '@/lib/validacionSocio';
import Reservas from './Reservas';

// El Select de Radix no se puede manejar bien en jsdom: se reemplaza por un <select> nativo
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (valor: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// Importes pensados para que NO salgan de ninguna cuenta local (ni 5000 ni 50 %):
// si la pantalla los muestra tal cual, es porque los trajo del backend.
const COTIZACION_DEL_BACKEND: Cotizacion = {
  moneda: 'ARS',
  subtotal: 17000,
  descuento_total: 2550,
  total: 14450,
  cantidad_socios: 0,
  detalle: [
    {
      indice: 0,
      condicion_efectiva: 'visitante',
      descuento_codigo: 'mayores',
      descuento_pct: 15,
      precio_base: 8500,
      precio_final: 7225,
    },
    {
      indice: 1,
      condicion_efectiva: 'visitante',
      descuento_codigo: 'mayores',
      descuento_pct: 15,
      precio_base: 8500,
      precio_final: 7225,
    },
  ],
};

const DNI_SOCIO = '41234567';

const SOCIO_VIGENTE: ValidacionSocio = {
  valido: true,
  motivo: null,
  nombre: 'Ana Pérez',
  condicion: 'socio',
};

const rechazo = (motivo: 'NO_EXISTE' | 'NO_ES_SOCIO' | 'CUOTA_VENCIDA'): ValidacionSocio => ({
  valido: false,
  motivo,
  nombre: null,
  condicion: null,
});

const USUARIO_SOCIO: UsuarioSesion = {
  id: 'u-1',
  nombre: 'Ana Pérez',
  email: 'ana@test.com',
  dni: DNI_SOCIO,
  rol: 'CLIENTE',
  is_socio: true,
  membresia_vigente: true,
  membresia_vence: '2030-12-31',
};

interface Escenario {
  cotizacion?: Cotizacion | 'error';
  // Si no hay usuario, GET /auth/me falla y el formulario se completa a mano
  usuario?: UsuarioSesion;
  // Respuesta de GET /socios/validar/{dni} para cada DNI
  socios?: Record<string, ValidacionSocio | 'error'>;
}

function simularBackend({ cotizacion = COTIZACION_DEL_BACKEND, usuario, socios = {} }: Escenario = {}) {
  const fetchFalso = vi.fn().mockImplementation(async (url: string) => {
    const ruta = String(url);
    if (ruta.endsWith('/reservas/cotizar')) {
      if (cotizacion === 'error') return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => cotizacion };
    }
    if (ruta.endsWith('/auth/me')) {
      if (!usuario) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => usuario };
    }
    const validacion = /\/socios\/validar\/(\d+)$/.exec(ruta);
    if (validacion) {
      const respuesta = socios[validacion[1]] ?? rechazo('NO_EXISTE');
      if (respuesta === 'error') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => respuesta };
    }
    if (ruta.endsWith('/reservas/')) return { ok: true, json: async () => ({ id: 'r-1' }) };
    if (ruta.endsWith('/api/payments/create')) return { ok: true, json: async () => ({}) };
    throw new Error(`Llamada inesperada a ${ruta}`);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

function mostrarReservas(personas = '2') {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/reservas',
          state: { fecha: '2030-01-10', fechaEgreso: '2030-01-10', personas, tipo: 'carpa' },
        },
      ]}
    >
      <AuthProvider>
        <Reservas />
      </AuthProvider>
    </MemoryRouter>
  );
}

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken() {
  const payload = base64Url({ sub: 'u-1', rol: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

// Los campos de edad son los únicos inputs numéricos de hasta 3 dígitos
function camposDeEdad(contenedor: HTMLElement) {
  return Array.from(
    contenedor.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"][maxlength="3"]')
  );
}

function camposDeDni(contenedor: HTMLElement) {
  return Array.from(
    contenedor.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"][maxlength="8"]')
  );
}

function camposDeNombre(contenedor: HTMLElement) {
  return Array.from(contenedor.querySelectorAll<HTMLInputElement>('input[maxlength="100"]'));
}

function cargarEdades(contenedor: HTMLElement, edades: string[]) {
  camposDeEdad(contenedor).forEach((campo, i) =>
    fireEvent.change(campo, { target: { value: edades[i] } })
  );
}

// Pone a la persona `indice` como socio y escribe su DNI
function cargarSocio(contenedor: HTMLElement, indice: number, dni: string) {
  const selectores = contenedor.querySelectorAll('select');
  fireEvent.change(selectores[indice], { target: { value: 'socio' } });
  fireEvent.change(camposDeDni(contenedor).at(-1)!, { target: { value: dni } });
}

function apretarPagar() {
  fireEvent.click(screen.getByRole('button', { name: /pagar con mercado pago/i }));
}

function llamadasA(fetchFalso: ReturnType<typeof simularBackend>, sufijo: string) {
  return fetchFalso.mock.calls.filter(([url]) => String(url).endsWith(sufijo));
}

function cuerpoDeLaReserva(fetchFalso: ReturnType<typeof simularBackend>) {
  const llamada = llamadasA(fetchFalso, '/reservas/')[0];
  return JSON.parse(llamada[1].body);
}

// Completa el formulario sin sesión y aprieta "Pagar"; devuelve el fetch falso para mirar sus llamadas
async function reservar(escenario: Escenario = {}) {
  const fetchFalso = simularBackend(escenario);
  const { container } = mostrarReservas();

  fireEvent.change(container.querySelector('input[type="email"]')!, {
    target: { value: 'ana@test.com' },
  });
  const nombres = camposDeNombre(container);
  fireEvent.change(nombres[0], { target: { value: 'Ana Pérez' } });
  fireEvent.change(nombres[1], { target: { value: 'Luis Pérez' } });
  cargarEdades(container, ['34', '8']);
  apretarPagar();

  await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1));
  return fetchFalso;
}

describe('Reservas: precio calculado por el backend', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('no cotiza ni muestra un precio mientras falten las edades', () => {
    const fetchFalso = simularBackend();

    mostrarReservas();

    expect(screen.getByText(/completá la edad de cada persona/i)).toBeTruthy();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('muestra el subtotal, el descuento y el total que devuelve el backend', async () => {
    simularBackend();
    const { container } = mostrarReservas();

    cargarEdades(container, ['70', '68']);

    await waitFor(() => expect(screen.getByText(/14\.450/)).toBeTruthy());
    expect(screen.getByText(/17\.000/)).toBeTruthy();
    expect(screen.getByText(/-\$2\.?550/)).toBeTruthy();
  });

  it('manda a cotizar la edad y la condición de cada persona', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrarReservas();

    cargarEdades(container, ['70', '68']);

    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
    const [, opciones] = fetchFalso.mock.calls[0];
    expect(JSON.parse(opciones.body)).toEqual({
      personas: [
        { edad: 70, condicion: 'visitante' },
        { edad: 68, condicion: 'visitante' },
      ],
    });
  });

  it('no muestra la fila de descuento si el backend no aplicó ninguno', async () => {
    simularBackend({
      cotizacion: {
        ...COTIZACION_DEL_BACKEND,
        subtotal: 17000,
        descuento_total: 0,
        total: 17000,
      },
    });
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);

    await waitFor(() => expect(screen.getAllByText(/17\.000/).length).toBeGreaterThan(0));
    expect(screen.queryByText('Descuentos')).toBeNull();
  });

  it('avisa si no se pudo calcular el precio y no inventa un importe', async () => {
    simularBackend({ cotizacion: 'error' });
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);

    await waitFor(() => expect(screen.getByText(/no pudimos calcular el precio/i)).toBeTruthy());
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('vuelve a cotizar cuando cambia una edad', async () => {
    const fetchFalso = simularBackend();
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);
    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));
    fireEvent.change(camposDeEdad(container)[0], { target: { value: '70' } });

    await waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchFalso.mock.calls[1][1].body).personas[0].edad).toBe(70);
  });
});

describe('Reservas: sin teléfono', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('no muestra ningún campo de teléfono', () => {
    simularBackend();
    const { container } = mostrarReservas();

    expect(container.querySelector('input[type="tel"]')).toBeNull();
    expect(screen.queryByText(/teléfono/i)).toBeNull();
  });

  it('crea la reserva sin mandar teléfono y con la lista completa de personas', async () => {
    const fetchFalso = await reservar();

    const cuerpo = cuerpoDeLaReserva(fetchFalso);
    expect(cuerpo).not.toHaveProperty('telefono');
    expect(cuerpo.email).toBe('ana@test.com');
    expect(cuerpo.personas).toEqual([
      { nombre: 'Ana Pérez', edad: 34, condicion: 'visitante' },
      { nombre: 'Luis Pérez', edad: 8, condicion: 'visitante' },
    ]);
  });
});

describe('Reservas: con y sin sesión', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sin sesión reserva igual: no pide el usuario de prueba, no manda user_id ni Authorization', async () => {
    const fetchFalso = await reservar();

    const llamada = llamadasA(fetchFalso, '/reservas/')[0];
    expect(JSON.parse(llamada[1].body)).not.toHaveProperty('user_id');
    expect(llamada[1].headers).not.toHaveProperty('Authorization');
    expect(fetchFalso.mock.calls.some(([url]) => String(url).includes('/usuarios/prueba'))).toBe(false);
    expect(llamadasA(fetchFalso, '/auth/me')).toHaveLength(0);
  });

  it('con sesión manda el token para que el backend asocie la reserva, sin user_id', async () => {
    const token = crearToken();
    localStorage.setItem(TOKEN_KEY, token);

    // Sin datos de la cuenta (/auth/me falla) el formulario se completa a mano
    const fetchFalso = await reservar();

    const llamada = llamadasA(fetchFalso, '/reservas/')[0];
    expect(llamada[1].headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(llamada[1].body)).not.toHaveProperty('user_id');
  });
});

describe('Reservas: verificación del DNI de socios', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('verifica el DNI completo y muestra el nombre del socio', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: SOCIO_VIGENTE } });
    const { container } = mostrarReservas();

    cargarSocio(container, 0, DNI_SOCIO);

    await waitFor(() => expect(screen.getByText(/socio verificado: ana pérez/i)).toBeTruthy());
    expect(llamadasA(fetchFalso, `/socios/validar/${DNI_SOCIO}`)).toHaveLength(1);
  });

  it('verifica al salir del campo un DNI de 7 dígitos', async () => {
    const fetchFalso = simularBackend({ socios: { '1234567': SOCIO_VIGENTE } });
    const { container } = mostrarReservas();

    cargarSocio(container, 0, '1234567');
    expect(llamadasA(fetchFalso, '/socios/validar/1234567')).toHaveLength(0);
    fireEvent.blur(camposDeDni(container)[0]);

    await waitFor(() => expect(llamadasA(fetchFalso, '/socios/validar/1234567')).toHaveLength(1));
  });

  it('cotiza como visitante hasta verificar el DNI y como socio después', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: SOCIO_VIGENTE } });
    const { container } = mostrarReservas();

    cargarEdades(container, ['30', '31']);
    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1));
    cargarSocio(container, 0, DNI_SOCIO);

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(2));
    const cotizaciones = llamadasA(fetchFalso, '/reservas/cotizar');
    expect(JSON.parse(cotizaciones[0][1].body).personas[0].condicion).toBe('visitante');
    expect(JSON.parse(cotizaciones[1][1].body).personas[0].condicion).toBe('socio');
  });

  it.each([
    ['NO_EXISTE', /no encontramos ningún socio/i],
    ['NO_ES_SOCIO', /no pertenece a un socio/i],
    ['CUOTA_VENCIDA', /cuota de este socio está vencida/i],
  ] as const)('bloquea la reserva si el motivo es %s', async (motivo, mensaje) => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: rechazo(motivo) } });
    const { container } = mostrarReservas();

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'ana@test.com' },
    });
    fireEvent.change(camposDeNombre(container)[0], { target: { value: 'Ana Pérez' } });
    fireEvent.change(camposDeNombre(container)[1], { target: { value: 'Luis Pérez' } });
    cargarEdades(container, ['34', '8']);
    cargarSocio(container, 0, DNI_SOCIO);
    apretarPagar();

    await waitFor(() => expect(screen.getAllByText(mensaje).length).toBeGreaterThan(0));
    expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(0);
  });

  it('bloquea la reserva si no se puede verificar el DNI', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: 'error' } });
    const { container } = mostrarReservas();

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'ana@test.com' },
    });
    fireEvent.change(camposDeNombre(container)[0], { target: { value: 'Ana Pérez' } });
    fireEvent.change(camposDeNombre(container)[1], { target: { value: 'Luis Pérez' } });
    cargarEdades(container, ['34', '8']);
    cargarSocio(container, 0, DNI_SOCIO);
    apretarPagar();

    await waitFor(() =>
      expect(screen.getAllByText(/no pudimos verificar el dni/i).length).toBeGreaterThan(0)
    );
    expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(0);
  });

  it('con el DNI verificado envía a cada persona con su DNI', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: SOCIO_VIGENTE } });
    const { container } = mostrarReservas();

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'ana@test.com' },
    });
    fireEvent.change(camposDeNombre(container)[0], { target: { value: 'Ana Pérez' } });
    fireEvent.change(camposDeNombre(container)[1], { target: { value: 'Luis Pérez' } });
    cargarEdades(container, ['34', '8']);
    cargarSocio(container, 0, DNI_SOCIO);
    apretarPagar();

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1));
    expect(cuerpoDeLaReserva(fetchFalso).personas).toEqual([
      { nombre: 'Ana Pérez', edad: 34, condicion: 'socio', dni: DNI_SOCIO },
      { nombre: 'Luis Pérez', edad: 8, condicion: 'visitante' },
    ]);
  });

  it('no deja repetir el mismo DNI en dos personas', async () => {
    const fetchFalso = simularBackend({ socios: { [DNI_SOCIO]: SOCIO_VIGENTE } });
    const { container } = mostrarReservas();

    fireEvent.change(container.querySelector('input[type="email"]')!, {
      target: { value: 'ana@test.com' },
    });
    fireEvent.change(camposDeNombre(container)[0], { target: { value: 'Ana Pérez' } });
    fireEvent.change(camposDeNombre(container)[1], { target: { value: 'Luis Pérez' } });
    cargarEdades(container, ['34', '36']);
    cargarSocio(container, 0, DNI_SOCIO);
    cargarSocio(container, 1, DNI_SOCIO);
    apretarPagar();

    await waitFor(() => expect(screen.getByText(/ya está cargado en otra persona/i)).toBeTruthy());
    expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(0);
  });
});

describe('Reservas: datos del socio con sesión', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, crearToken());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('precarga el nombre y el email del socio y no se los vuelve a pedir', async () => {
    simularBackend({ usuario: USUARIO_SOCIO });
    const { container } = mostrarReservas();

    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeTruthy());
    expect(screen.getByText(/socio del camping · dni 41234567/i)).toBeTruthy();
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe(
      'ana@test.com'
    );
    // De las dos personas solo la segunda pide nombre; el DNI no se pide a nadie
    expect(camposDeNombre(container)).toHaveLength(1);
    expect(camposDeDni(container)).toHaveLength(0);
    expect(container.querySelectorAll('select')).toHaveLength(1);
  });

  it('cotiza al titular como socio sin consultar su DNI', async () => {
    const fetchFalso = simularBackend({ usuario: USUARIO_SOCIO });
    const { container } = mostrarReservas();
    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeTruthy());

    cargarEdades(container, ['34', '8']);

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/cotizar')).toHaveLength(1));
    const cotizacion = JSON.parse(llamadasA(fetchFalso, '/reservas/cotizar')[0][1].body);
    expect(cotizacion.personas).toEqual([
      { edad: 34, condicion: 'socio' },
      { edad: 8, condicion: 'visitante' },
    ]);
    expect(fetchFalso.mock.calls.some(([url]) => String(url).includes('/socios/validar'))).toBe(false);
  });

  it('envía al titular con los datos de su cuenta', async () => {
    const fetchFalso = simularBackend({ usuario: USUARIO_SOCIO });
    const { container } = mostrarReservas();
    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeTruthy());

    fireEvent.change(camposDeNombre(container)[0], { target: { value: 'Luis Pérez' } });
    cargarEdades(container, ['34', '8']);
    apretarPagar();

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1));
    const cuerpo = cuerpoDeLaReserva(fetchFalso);
    expect(cuerpo.email).toBe('ana@test.com');
    expect(cuerpo.personas).toEqual([
      { nombre: 'Ana Pérez', edad: 34, condicion: 'socio', dni: DNI_SOCIO },
      { nombre: 'Luis Pérez', edad: 8, condicion: 'visitante' },
    ]);
  });

  it('con la cuota vencida precarga el nombre pero lo trata como visitante', async () => {
    const fetchFalso = simularBackend({
      usuario: { ...USUARIO_SOCIO, membresia_vigente: false, membresia_vence: '2020-01-01' },
    });
    const { container } = mostrarReservas();
    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeTruthy());

    expect(screen.getByText(/tu cuota está vencida/i)).toBeTruthy();
    fireEvent.change(camposDeNombre(container)[0], { target: { value: 'Luis Pérez' } });
    cargarEdades(container, ['34', '8']);
    apretarPagar();

    await waitFor(() => expect(llamadasA(fetchFalso, '/reservas/')).toHaveLength(1));
    expect(cuerpoDeLaReserva(fetchFalso).personas[0]).toEqual({
      nombre: 'Ana Pérez',
      edad: 34,
      condicion: 'visitante',
    });
    expect(JSON.parse(llamadasA(fetchFalso, '/reservas/cotizar')[0][1].body).personas[0].condicion).toBe(
      'visitante'
    );
  });

  it('un cliente que no es socio también tiene su nombre y su email precargados', async () => {
    simularBackend({
      usuario: { ...USUARIO_SOCIO, is_socio: false, membresia_vigente: false, membresia_vence: null },
    });
    const { container } = mostrarReservas();

    await waitFor(() => expect(screen.getByText('Ana Pérez')).toBeTruthy());
    // "Visitante General" también es una opción del selector de la otra persona: se mira solo el texto del titular
    expect(screen.getAllByText('Visitante General').some((el) => el.tagName === 'P')).toBe(true);
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe(
      'ana@test.com'
    );
  });
});