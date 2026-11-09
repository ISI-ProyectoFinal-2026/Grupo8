import { describe, expect, it } from 'vitest';
import {
  cambiosEdicion,
  construirConsulta,
  construirPayload,
  estadoDeSocio,
  fechaRenovacionSugerida,
  filtrosVacios,
  formularioEdicion,
  formularioVacio,
  hayFiltros,
  sumarAnios,
  validarEdicion,
  validarRenovacion,
  type Socio,
  validarPassword,
  validarSocio,
  validarVencimiento,
  type SocioFormulario,
} from './socios';

const formValido: SocioFormulario = {
  nombre: 'Ana Pérez',
  dni: '41234567',
  email: 'ana@correo.com',
  password: 'inicial123',
  membresia_vence: '2026-12-31',
};

describe('validarPassword', () => {
  it.each(['12345678', 'inicial123', 'con espacios 1', 'a'.repeat(72)])('acepta "%s"', (v) => {
    expect(validarPassword(v)).toBeNull();
  });

  it('rechaza una contraseña vacía', () => {
    expect(validarPassword('')).toMatch(/obligatoria/i);
  });

  it('rechaza menos de 8 caracteres', () => {
    expect(validarPassword('1234567')).toMatch(/al menos 8/i);
  });

  it('no recorta los espacios: 8 espacios son una contraseña de 8 caracteres', () => {
    expect(validarPassword('        ')).toBeNull();
  });

  it('rechaza más de 72 bytes, contando los caracteres con acento', () => {
    expect(validarPassword('a'.repeat(73))).toMatch(/demasiado larga/i);
    // 37 letras de 2 bytes = 74 bytes
    expect(validarPassword('ñ'.repeat(37))).toMatch(/demasiado larga/i);
    expect(validarPassword('ñ'.repeat(36))).toBeNull();
  });
});

describe('validarVencimiento', () => {
  it('acepta una fecha real', () => {
    expect(validarVencimiento('2026-12-31')).toBeNull();
  });

  it.each(['', '31/12/2026', '2026-02-30', '2026-13-01'])('rechaza "%s"', (v) => {
    expect(validarVencimiento(v)).not.toBeNull();
  });
});

describe('validarSocio', () => {
  it('no devuelve errores con datos válidos', () => {
    expect(validarSocio(formValido)).toEqual({});
  });

  it('exige todos los campos', () => {
    expect(Object.keys(validarSocio(formularioVacio)).sort()).toEqual(
      ['dni', 'email', 'membresia_vence', 'nombre', 'password']
    );
  });

  it('el DNI es de 7 u 8 dígitos', () => {
    expect(validarSocio({ ...formValido, dni: '1234567' }).dni).toBeUndefined();
    expect(validarSocio({ ...formValido, dni: '12345678' }).dni).toBeUndefined();
    expect(validarSocio({ ...formValido, dni: '123456' }).dni).toBeDefined();
    expect(validarSocio({ ...formValido, dni: '123456789' }).dni).toBeDefined();
    expect(validarSocio({ ...formValido, dni: '12.345.678' }).dni).toBeDefined();
  });

  it('valida el email y el nombre', () => {
    expect(validarSocio({ ...formValido, email: 'ana@' }).email).toBeDefined();
    expect(validarSocio({ ...formValido, nombre: 'Ana 123' }).nombre).toBeDefined();
  });

  it('informa solo los campos con error', () => {
    expect(Object.keys(validarSocio({ ...formValido, password: 'corta' }))).toEqual(['password']);
  });
});

describe('construirPayload', () => {
  it('recorta nombre, DNI y email pero no la contraseña', () => {
    expect(
      construirPayload({
        ...formValido,
        nombre: '  Ana Pérez ',
        dni: ' 41234567 ',
        email: ' ana@correo.com ',
        password: ' inicial123 ',
      })
    ).toEqual({
      nombre: 'Ana Pérez',
      dni: '41234567',
      email: 'ana@correo.com',
      password: ' inicial123 ',
      membresia_vence: '2026-12-31',
    });
  });
});

const SOCIO: Socio = {
  id: 'id-ana',
  nombre: 'Ana Pérez',
  dni: '41234567',
  email: 'ana@correo.com',
  membresia_vence: '2026-12-31',
  membresia_vigente: true,
  activo: true,
};

describe('estadoDeSocio', () => {
  it('vigente si está activo y con la cuota al día', () => {
    expect(estadoDeSocio(SOCIO)).toBe('vigente');
  });

  it('vencida si está activo pero la cuota no está al día', () => {
    expect(estadoDeSocio({ ...SOCIO, membresia_vigente: false })).toBe('vencida');
  });

  it('de baja aunque la fecha esté al día', () => {
    expect(estadoDeSocio({ ...SOCIO, activo: false })).toBe('baja');
    expect(estadoDeSocio({ ...SOCIO, activo: false, membresia_vigente: false })).toBe('baja');
  });
});

describe('construirConsulta', () => {
  it('sin filtros no agrega parámetros', () => {
    expect(construirConsulta(filtrosVacios)).toBe('');
    expect(construirConsulta({ buscar: '   ', estado: '' })).toBe('');
  });

  it('recorta y codifica el texto buscado', () => {
    expect(construirConsulta({ buscar: '  Núñez ', estado: '' })).toBe('?buscar=N%C3%BA%C3%B1ez');
    expect(construirConsulta({ buscar: 'a&b=c', estado: '' })).toBe('?buscar=a%26b%3Dc');
  });

  it('combina búsqueda y estado', () => {
    expect(construirConsulta({ buscar: '30111', estado: 'baja' })).toBe('?buscar=30111&estado=baja');
    expect(construirConsulta({ buscar: '', estado: 'vencida' })).toBe('?estado=vencida');
  });

  it('hayFiltros solo cuenta los que tienen valor', () => {
    expect(hayFiltros(filtrosVacios)).toBe(false);
    expect(hayFiltros({ buscar: '  ', estado: '' })).toBe(false);
    expect(hayFiltros({ buscar: 'ana', estado: '' })).toBe(true);
    expect(hayFiltros({ buscar: '', estado: 'vigente' })).toBe(true);
  });
});

describe('edición', () => {
  it('el formulario arranca con los datos actuales', () => {
    expect(formularioEdicion(SOCIO)).toEqual({ nombre: 'Ana Pérez', dni: '41234567', email: 'ana@correo.com' });
  });

  it('solo devuelve los campos que cambiaron, ya recortados', () => {
    expect(cambiosEdicion(SOCIO, formularioEdicion(SOCIO))).toEqual({});
    expect(cambiosEdicion(SOCIO, { ...formularioEdicion(SOCIO), nombre: ' Ana María Pérez ' })).toEqual({
      nombre: 'Ana María Pérez',
    });
    expect(cambiosEdicion(SOCIO, { nombre: 'Ana Pérez', dni: '30111222', email: 'otra@correo.com' })).toEqual({
      dni: '30111222',
      email: 'otra@correo.com',
    });
  });

  it('un email que solo cambia en mayúsculas no cuenta como cambio', () => {
    expect(cambiosEdicion(SOCIO, { ...formularioEdicion(SOCIO), email: 'ANA@correo.com' })).toEqual({});
  });

  it('valida nombre, DNI y email con las mismas reglas que el alta', () => {
    expect(validarEdicion(formularioEdicion(SOCIO))).toEqual({});
    const errores = validarEdicion({ nombre: '', dni: '12.345', email: 'ana@' });
    expect(Object.keys(errores).sort()).toEqual(['dni', 'email', 'nombre']);
  });
});

describe('renovación', () => {
  const HOY = '2026-11-08';

  it('sumarAnios no se corre de día por la zona horaria', () => {
    expect(sumarAnios('2026-12-31', 1)).toBe('2027-12-31');
    expect(sumarAnios('2026-01-01', 1)).toBe('2027-01-01');
    expect(sumarAnios('2028-02-29', 1)).toBe('2029-03-01');
  });

  it('propone un año más desde el vencimiento si todavía no venció', () => {
    expect(fechaRenovacionSugerida({ ...SOCIO, membresia_vence: '2027-03-15' }, HOY)).toBe('2028-03-15');
  });

  it('propone un año desde hoy si ya venció, vence hoy o no tiene fecha', () => {
    expect(fechaRenovacionSugerida({ ...SOCIO, membresia_vence: '2025-01-10' }, HOY)).toBe('2027-11-08');
    expect(fechaRenovacionSugerida({ ...SOCIO, membresia_vence: HOY }, HOY)).toBe('2027-11-08');
    expect(fechaRenovacionSugerida({ ...SOCIO, membresia_vence: null }, HOY)).toBe('2027-11-08');
  });

  it('acepta hoy y fechas futuras', () => {
    expect(validarRenovacion(HOY, HOY)).toBeNull();
    expect(validarRenovacion('2027-01-01', HOY)).toBeNull();
  });

  it('rechaza fechas pasadas, vacías o inexistentes', () => {
    expect(validarRenovacion('2026-11-07', HOY)).toMatch(/anterior a hoy/i);
    expect(validarRenovacion('', HOY)).toMatch(/obligatoria/i);
    expect(validarRenovacion('2027-02-30', HOY)).toMatch(/no existe/i);
  });
});
