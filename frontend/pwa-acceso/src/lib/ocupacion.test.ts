import { describe, expect, it } from 'vitest';
import {
  nivelOcupacion,
  porcentajeBuffer,
  porcentajeOcupacion,
  UMBRAL_AMARILLO,
  UMBRAL_ROJO,
  validarCantidadEgreso,
} from './ocupacion';

describe('porcentajeOcupacion', () => {
  it('redondea al entero más cercano', () => {
    expect(porcentajeOcupacion(1, 3)).toBe(33);
    expect(porcentajeOcupacion(30, 50)).toBe(60);
  });

  it('puede pasar de 100 si entró más gente que la capacidad', () => {
    expect(porcentajeOcupacion(55, 50)).toBe(110);
  });

  it('con capacidad 0 devuelve 0 en lugar de dividir por cero', () => {
    expect(porcentajeOcupacion(5, 0)).toBe(0);
  });
});

describe('nivelOcupacion', () => {
  it.each([
    [0, 'verde'],
    [UMBRAL_AMARILLO - 1, 'verde'],
    [UMBRAL_AMARILLO, 'amarillo'],
    [UMBRAL_ROJO - 1, 'amarillo'],
    [UMBRAL_ROJO, 'rojo'],
    [120, 'rojo'],
  ])('%i %% es %s', (porcentaje, nivel) => {
    expect(nivelOcupacion(porcentaje)).toBe(nivel);
  });
});

describe('porcentajeBuffer', () => {
  it('es la parte del cupo reservada al buffer', () => {
    expect(porcentajeBuffer(5, 50)).toBe(10);
  });

  it('sin buffer o sin capacidad es 0, y nunca pasa de 100', () => {
    expect(porcentajeBuffer(0, 50)).toBe(0);
    expect(porcentajeBuffer(5, 0)).toBe(0);
    expect(porcentajeBuffer(80, 50)).toBe(100);
  });
});

describe('validarCantidadEgreso', () => {
  it('acepta un entero entre 1 y las personas dentro', () => {
    expect(validarCantidadEgreso('3', 10)).toBeNull();
    expect(validarCantidadEgreso(' 10 ', 10)).toBeNull();
  });

  it('sin ocupación cargada no limita el máximo (lo controla el backend)', () => {
    expect(validarCantidadEgreso('500', null)).toBeNull();
  });

  it.each([
    ['', /cuántas personas/],
    ['abc', /número entero/],
    ['2.5', /número entero/],
    ['-1', /número entero/],
    ['0', /al menos 1/],
  ])('rechaza "%s"', (valor, mensaje) => {
    expect(validarCantidadEgreso(valor, 10)).toMatch(mensaje);
  });

  it('rechaza más personas de las que hay dentro', () => {
    expect(validarCantidadEgreso('11', 10)).toBe('Solo hay 10 personas dentro del camping.');
    expect(validarCantidadEgreso('2', 1)).toBe('Solo hay 1 persona dentro del camping.');
  });
});