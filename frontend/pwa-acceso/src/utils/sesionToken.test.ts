import { describe, expect, it } from 'vitest';
import {
  leerExpiracion,
  msHastaVencimiento,
  tokenVencido,
} from './sesionToken';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// JWT con firma inventada: el helper solo lee el payload, que es justo lo que se prueba
function crearToken(payload: object) {
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(payload)}.firma-cualquiera`;
}

const AHORA = Date.UTC(2026, 10, 28, 12, 0, 0);
const enSegundos = (ms: number) => Math.floor(ms / 1000);

describe('leerExpiracion (28.2)', () => {
  it('devuelve el exp del token sin necesitar ninguna clave', () => {
    expect(leerExpiracion(crearToken({ exp: 1796007600 }))).toBe(1796007600);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['cadena vacía', ''],
    ['texto cualquiera', 'esto-no-es-un-jwt'],
    ['dos partes', 'aaa.bbb'],
    ['payload que no es JSON', `${base64Url({ alg: 'x' })}.@@@.firma`],
  ])(
    'con un token ilegible (%s) devuelve null y no rompe',
    (_nombre, token) => {
      expect(leerExpiracion(token)).toBeNull();
    }
  );

  it('sin claim exp devuelve null', () => {
    expect(leerExpiracion(crearToken({ rol: 'SEGURIDAD' }))).toBeNull();
  });

  it.each([
    ['texto', '1796007600'],
    ['null', null],
    ['objeto', {}],
  ])('con un exp que no es un número (%s) devuelve null', (_nombre, exp) => {
    expect(leerExpiracion(crearToken({ exp }))).toBeNull();
  });
});

describe('tokenVencido (28.2)', () => {
  it('un token con exp en el futuro no está vencido', () => {
    expect(
      tokenVencido(crearToken({ exp: enSegundos(AHORA) + 3600 }), AHORA)
    ).toBe(false);
  });

  it('un token con exp en el pasado está vencido', () => {
    expect(
      tokenVencido(crearToken({ exp: enSegundos(AHORA) - 1 }), AHORA)
    ).toBe(true);
  });

  it('en el segundo exacto del exp ya cuenta como vencido (igual que el servidor)', () => {
    expect(tokenVencido(crearToken({ exp: enSegundos(AHORA) }), AHORA)).toBe(
      true
    );
    expect(
      tokenVencido(crearToken({ exp: enSegundos(AHORA) + 1 }), AHORA)
    ).toBe(false);
  });

  it('un token sin exp, ilegible o ausente no se considera vencido', () => {
    expect(tokenVencido(crearToken({ rol: 'SEGURIDAD' }), AHORA)).toBe(false);
    expect(tokenVencido('basura', AHORA)).toBe(false);
    expect(tokenVencido(null, AHORA)).toBe(false);
    expect(tokenVencido(undefined, AHORA)).toBe(false);
  });

  it('sin segundo argumento usa la hora actual', () => {
    expect(tokenVencido(crearToken({ exp: enSegundos(Date.now()) - 60 }))).toBe(
      true
    );
    expect(
      tokenVencido(crearToken({ exp: enSegundos(Date.now()) + 3600 }))
    ).toBe(false);
  });
});

describe('msHastaVencimiento (28.2)', () => {
  it('devuelve cuánto falta', () => {
    expect(
      msHastaVencimiento(crearToken({ exp: enSegundos(AHORA) + 90 }), AHORA)
    ).toBe(90_000);
  });

  it('devuelve null si ya venció, si no tiene exp o si el token es ilegible', () => {
    expect(
      msHastaVencimiento(crearToken({ exp: enSegundos(AHORA) - 5 }), AHORA)
    ).toBeNull();
    expect(msHastaVencimiento(crearToken({}), AHORA)).toBeNull();
    expect(msHastaVencimiento('basura', AHORA)).toBeNull();
  });
});
