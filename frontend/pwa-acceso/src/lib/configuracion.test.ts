import { describe, expect, it } from 'vitest';
import {
  bufferEnPersonas,
  construirPayload,
  cupoOnline,
  formularioDesdeConfiguracion,
  validarBuffer,
  validarCapacidad,
  validarConfiguracion,
  type ConfiguracionFormulario,
} from './configuracion';

const formValido: ConfiguracionFormulario = {
  capacidad_total: '50',
  porcentaje_buffer_offline: '10',
  max_personas_por_reserva: '10',
};

describe('buffer en personas y cupo online', () => {
  it.each([
    [50, 10, 5], // el recomendado equivale a los 5 lugares sobre 50 de antes
    [45, 10, 5], // 4,5 se redondea hacia arriba
    [125, 10, 13],
    [50, 0, 0],
    [50, 100, 50],
    [7, 1, 1],
  ])(
    '%i personas con %i %% de buffer guardan %i lugares',
    (capacidad, porcentaje, buffer) => {
      expect(bufferEnPersonas(capacidad, porcentaje)).toBe(buffer);
      expect(cupoOnline(capacidad, porcentaje)).toBe(capacidad - buffer);
    }
  );
});

describe('validación del formulario', () => {
  it('acepta una configuración válida', () => {
    expect(validarConfiguracion(formValido)).toEqual({});
  });

  it('acepta un máximo igual al cupo online', () => {
    expect(
      validarConfiguracion({ ...formValido, max_personas_por_reserva: '45' })
    ).toEqual({});
  });

  it.each([
    ['', 'Ingresá el cupo del camping.'],
    ['0', 'El cupo tiene que ser mayor a 0.'],
    ['-5', 'El cupo tiene que ser un número entero.'],
    ['50.5', 'El cupo tiene que ser un número entero.'],
    ['abc', 'El cupo tiene que ser un número entero.'],
  ])('rechaza el cupo "%s"', (valor, mensaje) => {
    expect(validarCapacidad(valor)).toBe(mensaje);
  });

  it('rechaza un cupo enorme', () => {
    expect(validarCapacidad('10000000')).toMatch(/no puede superar/);
  });

  it.each([
    ['', 'Ingresá el porcentaje de buffer.'],
    ['101', 'El buffer tiene que estar entre 0 % y 100 %.'],
    ['-1', 'El buffer tiene que ser un porcentaje entero, sin decimales.'],
    ['10,5', 'El buffer tiene que ser un porcentaje entero, sin decimales.'],
  ])('rechaza el buffer "%s"', (valor, mensaje) => {
    expect(validarBuffer(valor)).toBe(mensaje);
  });

  it.each(['0', '100'])('acepta el buffer en el límite (%s %%)', (valor) => {
    expect(validarBuffer(valor)).toBeNull();
  });

  it.each([
    ['', 'Ingresá el máximo de personas por reserva.'],
    ['0', 'El máximo tiene que ser mayor a 0.'],
    ['2.5', 'El máximo tiene que ser un número entero.'],
    ['46', 'El máximo no puede superar el cupo online (45 personas).'],
  ])('rechaza el máximo "%s"', (valor, mensaje) => {
    expect(
      validarConfiguracion({ ...formValido, max_personas_por_reserva: valor })
    ).toEqual({
      max_personas_por_reserva: mensaje,
    });
  });

  it('no compara el máximo con el cupo si el cupo es inválido', () => {
    const errores = validarConfiguracion({
      ...formValido,
      capacidad_total: '0',
    });
    expect(errores.capacidad_total).toBeDefined();
    expect(errores.max_personas_por_reserva).toBeUndefined();
  });
});

describe('conversión de datos', () => {
  it('arma el formulario desde la configuración guardada', () => {
    expect(
      formularioDesdeConfiguracion({
        capacidad_total: 80,
        porcentaje_buffer_offline: 20,
        max_personas_por_reserva: 6,
        porcentaje_buffer_recomendado: 10,
      })
    ).toEqual({
      capacidad_total: '80',
      porcentaje_buffer_offline: '20',
      max_personas_por_reserva: '6',
    });
  });

  it('envía números enteros y sin espacios', () => {
    expect(
      construirPayload({ ...formValido, capacidad_total: ' 80 ' })
    ).toEqual({
      capacidad_total: 80,
      porcentaje_buffer_offline: 10,
      max_personas_por_reserva: 10,
    });
  });
});
