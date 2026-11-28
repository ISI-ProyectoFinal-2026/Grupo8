import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enviarContacto,
  ErrorContacto,
  MENSAJE_MAX,
  validarContacto,
  validarMensaje,
} from './contacto';

const VALIDO = {
  nombre: 'Ana Pérez',
  email: 'ana@correo.com',
  mensaje: 'Hola, quería consultar por las mascotas.',
};

function responder(status: number, cuerpo: unknown) {
  const fetchFalso = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => cuerpo,
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

describe('validaciones del formulario de Contacto (31.5)', () => {
  it('datos correctos no tienen errores', () => {
    expect(validarContacto(VALIDO)).toEqual({});
  });

  it('los campos vacíos son obligatorios', () => {
    const errores = validarContacto({ nombre: '', email: '', mensaje: '' });

    expect(errores.nombre).toBe('El nombre es obligatorio.');
    expect(errores.email).toBe('El email es obligatorio.');
    expect(errores.mensaje).toBe('El mensaje es obligatorio.');
  });

  it('rechaza un correo con formato inválido', () => {
    expect(validarContacto({ ...VALIDO, email: 'ana@' }).email).toMatch(/email válido/);
  });

  it('rechaza un mensaje demasiado corto o demasiado largo', () => {
    expect(validarMensaje('corto')).toMatch(/al menos 10/);
    expect(validarMensaje('a'.repeat(MENSAJE_MAX))).toBeNull();
    expect(validarMensaje('a'.repeat(MENSAJE_MAX + 1))).toMatch(/no puede superar/);
  });

  it('un mensaje de solo espacios cuenta como vacío', () => {
    expect(validarMensaje('          ')).toBe('El mensaje es obligatorio.');
  });
});

describe('enviarContacto (31.5)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envía por POST /contacto solo nombre, correo y mensaje, sin espacios de los bordes', async () => {
    const fetchFalso = responder(202, { mensaje: 'Listo' });

    const aviso = await enviarContacto({ ...VALIDO, nombre: '  Ana Pérez ' });

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/contacto');
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual(VALIDO);
    expect(aviso).toBe('Listo');
  });

  it.each([
    [429, 'Enviaste muchos mensajes en poco tiempo.'],
    [502, 'No pudimos enviar tu mensaje.'],
    [503, 'El formulario no está disponible.'],
  ])('en %i muestra el motivo que explica el backend', async (status, detail) => {
    responder(status, { detail });

    await expect(enviarContacto(VALIDO)).rejects.toMatchObject({ message: detail, status });
  });

  it('en 422 no muestra la lista técnica del backend', async () => {
    responder(422, { detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email' }] });

    await expect(enviarContacto(VALIDO)).rejects.toMatchObject({
      message: 'Revisá los datos ingresados e intentá nuevamente.',
      status: 422,
    });
  });

  it('un error con cuerpo que no es JSON usa el mensaje por defecto', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('no es json');
        },
      })
    );

    await expect(enviarContacto(VALIDO)).rejects.toMatchObject({
      message: expect.stringMatching(/No pudimos enviar tu mensaje/),
      status: 500,
    });
  });

  it('sin conexión falla con status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('red')));

    const error = await enviarContacto(VALIDO).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorContacto);
    expect(error.status).toBe(0);
  });
});
