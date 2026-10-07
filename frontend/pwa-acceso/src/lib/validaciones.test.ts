import { describe, expect, it } from 'vitest';
import {
  MAX_NOCHES,
  MAX_PERSONAS,
  validarCantidadPersonas,
  validarDni,
  validarEdad,
  validarEmail,
  validarFecha,
  validarFechasEstadia,
  validarNoches,
  validarNombre,
  validarTelefono,
} from './validaciones';

describe('validarCantidadPersonas', () => {
  it.each(['1', '2', String(MAX_PERSONAS)])('acepta %s', (v) => {
    expect(validarCantidadPersonas(v)).toBeNull();
  });
  it.each(['', '  ', '0', '-1', '2.5', '1e1', 'abc', String(MAX_PERSONAS + 1)])(
    'rechaza "%s"',
    (v) => {
      expect(validarCantidadPersonas(v)).not.toBeNull();
    }
  );
});

describe('validarEmail', () => {
  it.each(['ana@test.com', 'ana.perez+x@correo.com.ar'])('acepta %s', (v) => {
    expect(validarEmail(v)).toBeNull();
  });
  it.each(['', '  ', 'no-es-un-email', 'ana@test', 'ana perez@test.com', 'ana@@test.com', 'ana..perez@test.com', '.ana@test.com'])(
    'rechaza "%s"',
    (v) => {
      expect(validarEmail(v)).not.toBeNull();
    }
  );
});

describe('validarNombre', () => {
  it.each(['Ana Pérez', "José María O'Brien-Núñez", 'J. R. Smith', '  Ana  '])(
    'acepta "%s"',
    (v) => {
      expect(validarNombre(v)).toBeNull();
    }
  );
  it.each(['', '   ', 'A', '12345', 'Ana<script>', 'x'.repeat(101)])('rechaza "%s"', (v) => {
    expect(validarNombre(v)).not.toBeNull();
  });
});

describe('validarTelefono', () => {
  it.each(['2604123456', '5492604123456'])('acepta %s', (v) => {
    expect(validarTelefono(v)).toBeNull();
  });
  it.each([
    '', '  ', 'abc', '123', '1'.repeat(16), '26041234a6',
    '+54 9 260 412-3456', '(260) 412 3456', '260-412-3456', '260 412 3456',
  ])('rechaza "%s"', (v) => {
    expect(validarTelefono(v)).not.toBeNull();
  });
});

describe('validarEdad y validarDni', () => {
  it('edad', () => {
    expect(validarEdad('0')).toBeNull();
    expect(validarEdad('35')).toBeNull();
    ['', '-1', '3.5', 'abc', '121'].forEach((v) => expect(validarEdad(v)).not.toBeNull());
  });
  it('dni', () => {
    expect(validarDni('41234567')).toBeNull();
    expect(validarDni('1234567')).toBeNull();
    ['', '123', '41.234.567', 'abc', '123456789'].forEach((v) =>
      expect(validarDni(v)).not.toBeNull()
    );
  });
});

describe('fechas', () => {
  it('validarFecha', () => {
    expect(validarFecha('2030-12-20')).toBeNull();
    ['', '20-12-2030', '2030-02-30', 'mañana'].forEach((v) =>
      expect(validarFecha(v)).not.toBeNull()
    );
  });
  it('validarFechasEstadia acepta hoy y rangos de varios días', () => {
    expect(validarFechasEstadia('2030-06-10', '2030-06-10', '2030-06-10')).toEqual({});
    expect(validarFechasEstadia('2030-06-10', '2030-06-12', '2030-06-01')).toEqual({});
  });
  it('validarFechasEstadia rechaza ingreso pasado y egreso anterior', () => {
    expect(validarFechasEstadia('2030-06-09', '2030-06-10', '2030-06-10').ingreso).toBeDefined();
    expect(validarFechasEstadia('2030-06-10', '2030-06-09', '2030-06-01').egreso).toBeDefined();
  });
});

describe('validarNoches', () => {
  it.each(['1', String(MAX_NOCHES)])('acepta %s', (v) => {
    expect(validarNoches(v)).toBeNull();
  });
  it.each(['', '0', '-1', '2.5', 'abc', String(MAX_NOCHES + 1)])('rechaza "%s"', (v) => {
    expect(validarNoches(v)).not.toBeNull();
  });
});