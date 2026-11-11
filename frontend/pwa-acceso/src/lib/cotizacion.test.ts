import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cotizarPorUnidad,
  cotizarReserva,
  formatearMonto,
  personasParaCotizar,
  type Cotizacion,
} from './cotizacion';

const COTIZACION: Cotizacion = {
  moneda: 'ARS',
  subtotal: 10000,
  descuento_total: 1000,
  total: 9000,
  cantidad_socios: 1,
  detalle: [
    {
      indice: 0,
      condicion_efectiva: 'socio',
      descuento_codigo: 'socio',
      descuento_pct: 20,
      precio_base: 5000,
      precio_final: 4000,
    },
    {
      indice: 1,
      condicion_efectiva: 'visitante',
      descuento_codigo: null,
      descuento_pct: 0,
      precio_base: 5000,
      precio_final: 5000,
    },
  ],
};

describe('personasParaCotizar', () => {
  it('convierte la edad a número y respeta la condición', () => {
    expect(
      personasParaCotizar([
        { edad: '34', condicion: 'socio' },
        { edad: '8', condicion: 'visitante' },
      ])
    ).toEqual([
      { edad: 34, condicion: 'socio' },
      { edad: 8, condicion: 'visitante' },
    ]);
  });

  it('acepta la edad cero', () => {
    expect(personasParaCotizar([{ edad: '0', condicion: 'visitante' }])).toEqual([
      { edad: 0, condicion: 'visitante' },
    ]);
  });

  it('devuelve null si a alguna persona le falta la edad', () => {
    expect(
      personasParaCotizar([
        { edad: '34', condicion: 'socio' },
        { edad: '', condicion: 'visitante' },
      ])
    ).toBeNull();
  });

  it('devuelve null si una edad no es válida', () => {
    expect(personasParaCotizar([{ edad: '121', condicion: 'visitante' }])).toBeNull();
    expect(personasParaCotizar([{ edad: 'abc', condicion: 'visitante' }])).toBeNull();
  });

  it('devuelve null si no hay personas', () => {
    expect(personasParaCotizar([])).toBeNull();
  });

  it('trata una condición desconocida como visitante', () => {
    expect(personasParaCotizar([{ edad: '30', condicion: 'otra' }])).toEqual([
      { edad: 30, condicion: 'visitante' },
    ]);
  });
});

describe('formatearMonto', () => {
  it('muestra el signo $ y separa los miles al estilo argentino', () => {
    expect(formatearMonto(9000)).toMatch(/^\$9[. ]?000$/);
  });

  it('muestra los centavos solo cuando los hay', () => {
    expect(formatearMonto(3333.5)).toMatch(/^\$3[. ]?333,5$/);
  });
});

describe('cotizarReserva', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('manda las personas a POST /reservas/cotizar y devuelve lo que calculó el backend', async () => {
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => COTIZACION,
    });
    vi.stubGlobal('fetch', fetchFalso);
    const personas = [
      { edad: 34, condicion: 'socio' as const },
      { edad: 8, condicion: 'visitante' as const },
    ];

    const resultado = await cotizarReserva(personas);

    expect(resultado).toEqual(COTIZACION);
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(String(url)).toMatch(/\/reservas\/cotizar$/);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ personas });
  });

  it('con un tipo manda también tipo_reserva_id', async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true, json: async () => COTIZACION });
    vi.stubGlobal('fetch', fetchFalso);
    const personas = [{ edad: 34, condicion: 'visitante' as const }];

    await cotizarReserva(personas, undefined, 't-carpa');

    expect(JSON.parse(fetchFalso.mock.calls[0][1].body)).toEqual({ tipo_reserva_id: 't-carpa', personas });
  });

  it('muestra el motivo que explica el backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: 'Una reserva de Carpa admite como máximo 4 personas.' }),
      })
    );

    await expect(cotizarReserva([{ edad: 30, condicion: 'visitante' }])).rejects.toThrow(
      'Una reserva de Carpa admite como máximo 4 personas.'
    );
  });

  it('falla con un mensaje claro si el backend responde con error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    await expect(cotizarReserva([{ edad: 30, condicion: 'visitante' }])).rejects.toThrow(
      'No se pudo calcular el precio.'
    );
  });
});

describe('cotizarPorUnidad', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('manda el tipo, la cantidad y las fechas, sin personas', async () => {
    const respuesta = { ...COTIZACION, detalle: [], noches: 2, precio_unitario: 25000, forma_cobro: 'POR_UNIDAD' };
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true, json: async () => respuesta });
    vi.stubGlobal('fetch', fetchFalso);
    const pedido = {
      tipo_reserva_id: 't-cabana',
      cantidad_personas: 4,
      fecha_ingreso: '2030-01-10',
      fecha_egreso: '2030-01-12',
    };

    expect(await cotizarPorUnidad(pedido)).toEqual(respuesta);
    expect(String(fetchFalso.mock.calls[0][0])).toMatch(/\/reservas\/cotizar$/);
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body)).toEqual(pedido);
  });
});
