import { describe, expect, it } from 'vitest';
import {
  construirPayload,
  formularioVacio,
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
