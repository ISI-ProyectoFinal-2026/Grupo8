import { describe, expect, it } from 'vitest';
import {
  construirPayload,
  describirAplicacion,
  formatearPorcentaje,
  formularioDesdeDescuento,
  formularioVacio,
  parsearPorcentaje,
  validarCodigo,
  validarDescuento,
  validarLimiteEdad,
  validarNombreDescuento,
  validarPorcentaje,
  type Descuento,
  type DescuentoFormulario,
} from './descuentos';

const formValido: DescuentoFormulario = {
  codigo: 'menores_12',
  nombre: 'Menores de 12',
  aplica_a: 'edad',
  porcentaje: '50',
  edad_min: '0',
  edad_max: '12',
  activo: true,
};

describe('validarCodigo', () => {
  it.each(['socio', 'menores_12', 'ab', 'a'.repeat(30)])('acepta "%s"', (codigo) => {
    expect(validarCodigo(codigo)).toBeNull();
  });

  it.each(['', '  ', 'a', 'Menores', 'con espacio', '1abc', 'a-b', 'ñandu', 'a'.repeat(31)])(
    'rechaza "%s"',
    (codigo) => {
      expect(validarCodigo(codigo)).not.toBeNull();
    }
  );

  it('ignora los espacios al inicio y al final', () => {
    expect(validarCodigo('  socio  ')).toBeNull();
  });
});

describe('validarNombreDescuento', () => {
  it('acepta nombres de 2 a 100 caracteres', () => {
    expect(validarNombreDescuento('Socios')).toBeNull();
    expect(validarNombreDescuento('x'.repeat(100))).toBeNull();
  });

  it.each(['', '   ', 'A', 'x'.repeat(101)])('rechaza "%s"', (nombre) => {
    expect(validarNombreDescuento(nombre)).not.toBeNull();
  });
});

describe('validarPorcentaje', () => {
  it.each(['0', '100', '12.5', '12,5', '33.33', '0.01', ' 20 '])('acepta "%s"', (valor) => {
    expect(validarPorcentaje(valor)).toBeNull();
  });

  it.each(['', '   ', 'abc', '-1', '100.01', '101', '10.123', '1e2', '10%', '1.', '.5'])(
    'rechaza "%s"',
    (valor) => {
      expect(validarPorcentaje(valor)).not.toBeNull();
    }
  );

  it('convierte coma o punto en el mismo número', () => {
    expect(parsearPorcentaje('12,5')).toBe(12.5);
    expect(parsearPorcentaje('12.5')).toBe(12.5);
    expect(parsearPorcentaje('abc')).toBeNull();
  });
});

describe('validarLimiteEdad', () => {
  it.each(['0', '12', '120'])('acepta "%s"', (valor) => {
    expect(validarLimiteEdad(valor, 'La edad')).toBeNull();
  });

  it.each(['', 'abc', '-1', '121', '2.5'])('rechaza "%s"', (valor) => {
    expect(validarLimiteEdad(valor, 'La edad')).not.toBeNull();
  });
});

describe('validarDescuento', () => {
  it('no devuelve errores para un descuento por edad válido', () => {
    expect(validarDescuento(formValido, 'crear')).toEqual({});
  });

  it('no pide edades en un descuento para socios', () => {
    const form = { ...formValido, aplica_a: 'socio' as const, edad_min: '', edad_max: '' };
    expect(validarDescuento(form, 'crear')).toEqual({});
  });

  it('informa cada campo inválido', () => {
    const errores = validarDescuento(formularioVacio, 'crear');
    expect(Object.keys(errores).sort()).toEqual(['codigo', 'edad_max', 'edad_min', 'nombre', 'porcentaje']);
  });

  it('rechaza una edad mínima mayor que la máxima', () => {
    const errores = validarDescuento({ ...formValido, edad_min: '20', edad_max: '10' }, 'crear');
    expect(errores.edad_min).toMatch(/mayor/i);
  });

  it('al editar no valida el código, que no se puede cambiar', () => {
    expect(validarDescuento({ ...formValido, codigo: '' }, 'editar')).toEqual({});
  });
});

describe('construirPayload', () => {
  it('arma el alta de un descuento por edad', () => {
    expect(construirPayload({ ...formValido, codigo: ' menores_12 ', porcentaje: '12,5' }, 'crear')).toEqual({
      codigo: 'menores_12',
      aplica_a: 'edad',
      nombre: 'Menores de 12',
      porcentaje: 12.5,
      activo: true,
      edad_min: 0,
      edad_max: 12,
    });
  });

  it('no envía edades en un descuento para socios', () => {
    const payload = construirPayload(
      { ...formValido, aplica_a: 'socio', edad_min: '3', edad_max: '4' },
      'crear'
    );
    expect(payload).not.toHaveProperty('edad_min');
    expect(payload).not.toHaveProperty('edad_max');
  });

  it('al editar no envía el código ni a quién aplica', () => {
    const payload = construirPayload(formValido, 'editar');
    expect(payload).not.toHaveProperty('codigo');
    expect(payload).not.toHaveProperty('aplica_a');
    expect(payload).toMatchObject({ nombre: 'Menores de 12', porcentaje: 50, activo: true });
  });
});

describe('presentación', () => {
  const socio: Descuento = {
    id: '1',
    codigo: 'socio',
    nombre: 'Descuento para socios',
    aplica_a: 'socio',
    porcentaje: 20,
    edad_min: null,
    edad_max: null,
    activo: true,
  };

  it('describe a quién aplica cada descuento', () => {
    expect(describirAplicacion(socio)).toBe('Socios');
    expect(describirAplicacion({ ...socio, aplica_a: 'edad', edad_min: 0, edad_max: 12 })).toBe(
      'De 0 a 12 años'
    );
  });

  it('formatea el porcentaje', () => {
    expect(formatearPorcentaje(20)).toBe('20 %');
    expect(formatearPorcentaje(12.5)).toMatch(/^12[,.]5 %$/);
  });

  it('carga el formulario desde un descuento existente', () => {
    expect(formularioDesdeDescuento(socio)).toEqual({
      codigo: 'socio',
      nombre: 'Descuento para socios',
      aplica_a: 'socio',
      porcentaje: '20',
      edad_min: '',
      edad_max: '',
      activo: true,
    });
  });
});
