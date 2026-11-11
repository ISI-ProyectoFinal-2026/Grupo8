import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  construirPayload,
  crearTipo,
  describirPrecio,
  formularioDesdeTipo,
  formularioVacio,
  listarTipos,
  modificarTipo,
  obtenerTiposActivos,
  validarCantidadParaTipo,
  validarNochesParaTipo,
  validarTipo,
  type TipoFormulario,
  type TipoReserva,
} from './tiposReserva';
import { ErrorApi } from './descuentos';

const CARPA: TipoReserva = {
  id: 't-carpa',
  nombre: 'Carpa',
  precio: 5000,
  forma_cobro: 'POR_PERSONA',
  max_personas: 10,
  cantidad_unidades: null,
};

const CABANA: TipoReserva = {
  id: 't-cabana',
  nombre: 'Cabaña',
  precio: 25000,
  forma_cobro: 'POR_UNIDAD',
  max_personas: 6,
  cantidad_unidades: 4,
};

describe('describirPrecio', () => {
  it('aclara si es por persona o por noche', () => {
    expect(describirPrecio(CARPA)).toBe('$5.000 por persona');
    expect(describirPrecio(CABANA)).toBe('$25.000 por noche');
  });

  it('muestra los decimales si los hay', () => {
    expect(describirPrecio({ ...CARPA, precio: 4999.5 })).toBe(
      '$4.999,5 por persona'
    );
  });
});

describe('validarCantidadParaTipo', () => {
  it.each(['1', '6'])('acepta %s personas en la cabaña', (valor) => {
    expect(validarCantidadParaTipo(valor, CABANA)).toBeNull();
  });

  it('usa el máximo del tipo, no uno fijo', () => {
    expect(validarCantidadParaTipo('7', CABANA)).toBe(
      'Cabaña admite como máximo 6 personas.'
    );
    expect(validarCantidadParaTipo('7', CARPA)).toBeNull();
  });

  it.each([
    ['', 'La cantidad de personas es obligatoria.'],
    ['0', 'Debe haber al menos 1 persona.'],
    ['2.5', 'Ingresá un número entero válido.'],
  ])('rechaza "%s"', (valor, mensaje) => {
    expect(validarCantidadParaTipo(valor, CARPA)).toBe(mensaje);
  });
});

describe('validarNochesParaTipo', () => {
  it('por persona se puede pasar el día (0 noches)', () => {
    expect(validarNochesParaTipo('0', CARPA)).toBeNull();
  });

  it('por unidad hace falta al menos una noche', () => {
    expect(validarNochesParaTipo('0', CABANA)).toBe(
      'Cabaña se reserva por al menos 1 noche.'
    );
    expect(validarNochesParaTipo('1', CABANA)).toBeNull();
  });

  it.each(['', 'abc', '11'])('rechaza "%s"', (valor) => {
    expect(validarNochesParaTipo(valor, CARPA)).not.toBeNull();
  });
});

describe('formulario del panel', () => {
  const valido: TipoFormulario = {
    nombre: 'Domo',
    precio: '12000',
    forma_cobro: 'POR_UNIDAD',
    max_personas: '4',
    cantidad_unidades: '2',
    activo: true,
  };

  it('acepta un tipo válido', () => {
    expect(validarTipo(valido)).toEqual({});
  });

  it.each([
    [{ nombre: '' }, 'nombre'],
    [{ nombre: 'A' }, 'nombre'],
    [{ precio: '' }, 'precio'],
    [{ precio: '0' }, 'precio'],
    [{ precio: '10.555' }, 'precio'],
    [{ precio: 'abc' }, 'precio'],
    [{ max_personas: '' }, 'max_personas'],
    [{ max_personas: '0' }, 'max_personas'],
    [{ max_personas: '2.5' }, 'max_personas'],
    [{ cantidad_unidades: '0' }, 'cantidad_unidades'],
    [{ cantidad_unidades: 'x' }, 'cantidad_unidades'],
  ])('marca el error de %o en %s', (cambios, campo) => {
    expect(validarTipo({ ...valido, ...cambios })).toHaveProperty(campo);
  });

  it('acepta precio con coma decimal', () => {
    expect(validarTipo({ ...valido, precio: '4999,50' })).toEqual({});
    expect(construirPayload({ ...valido, precio: '4999,50' }).precio).toBe(
      4999.5
    );
  });

  it('por unidad, unidades vacías significa sin límite', () => {
    expect(
      construirPayload({ ...valido, cantidad_unidades: '' }).cantidad_unidades
    ).toBeNull();
  });

  it('por persona nunca manda unidades, aunque haya quedado algo escrito', () => {
    const payload = construirPayload({
      ...valido,
      forma_cobro: 'POR_PERSONA',
      cantidad_unidades: '3',
    });
    expect(payload.cantidad_unidades).toBeNull();
    expect(
      validarTipo({
        ...valido,
        forma_cobro: 'POR_PERSONA',
        cantidad_unidades: 'x',
      })
    ).toEqual({});
  });

  it('arma el payload con números', () => {
    expect(construirPayload({ ...valido, nombre: '  Domo  ' })).toEqual({
      nombre: 'Domo',
      precio: 12000,
      forma_cobro: 'POR_UNIDAD',
      max_personas: 4,
      cantidad_unidades: 2,
      activo: true,
    });
  });

  it('pasa un tipo guardado al formulario y vuelve igual', () => {
    const form = formularioDesdeTipo({ ...CABANA, activo: false });
    expect(form).toEqual({
      nombre: 'Cabaña',
      precio: '25000',
      forma_cobro: 'POR_UNIDAD',
      max_personas: '6',
      cantidad_unidades: '4',
      activo: false,
    });
    expect(
      formularioDesdeTipo({ ...CARPA, activo: true }).cantidad_unidades
    ).toBe('');
  });

  it('el formulario vacío arranca por persona y activo', () => {
    expect(formularioVacio.forma_cobro).toBe('POR_PERSONA');
    expect(formularioVacio.activo).toBe(true);
  });
});

describe('llamadas a la API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('obtiene los tipos activos sin sesión', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [CARPA] });
    vi.stubGlobal('fetch', fetchFalso);

    expect(await obtenerTiposActivos()).toEqual([CARPA]);
    expect(String(fetchFalso.mock.calls[0][0])).toMatch(
      /\/api\/v1\/tipos-reserva$/
    );
  });

  it('falla con un ErrorApi si no hay conexión o el backend responde error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );
    await expect(obtenerTiposActivos()).rejects.toBeInstanceOf(ErrorApi);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );
    await expect(obtenerTiposActivos()).rejects.toThrow(
      'No se pudieron cargar los tipos de reserva.'
    );
  });

  it('el ABM usa el token y la ruta del administrador', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchFalso);

    await listarTipos('tk');
    await crearTipo('tk', {
      ...formularioVacio,
      nombre: 'Domo',
      precio: '100',
      max_personas: '2',
    });
    await modificarTipo('tk', 't-1', { activo: false });

    const [listar, crear, modificar] = fetchFalso.mock.calls;
    expect(String(listar[0])).toMatch(/\/api\/v1\/admin\/tipos-reserva$/);
    expect(listar[1].headers.Authorization).toBe('Bearer tk');
    expect(crear[1].method).toBe('POST');
    expect(JSON.parse(crear[1].body).nombre).toBe('Domo');
    expect(String(modificar[0])).toMatch(
      /\/api\/v1\/admin\/tipos-reserva\/t-1$/
    );
    expect(modificar[1].method).toBe('PUT');
    expect(JSON.parse(modificar[1].body)).toEqual({ activo: false });
  });

  it('devuelve el mensaje del backend en un 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          detail: 'Ya existe un tipo de reserva con ese nombre.',
        }),
      })
    );

    const error = await crearTipo('tk', {
      ...formularioVacio,
      nombre: 'Carpa',
      precio: '1',
      max_personas: '1',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorApi);
    expect((error as ErrorApi).status).toBe(409);
    expect((error as ErrorApi).message).toBe(
      'Ya existe un tipo de reserva con ese nombre.'
    );
  });
});
