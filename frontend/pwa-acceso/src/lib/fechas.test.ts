import { describe, expect, it } from 'vitest';
import { sumarDias } from './fechas';

describe('sumarDias', () => {
  it('suma dentro del mes y cruza mes/año', () => {
    expect(sumarDias('2030-06-10', 3)).toBe('2030-06-13');
    expect(sumarDias('2030-01-30', 3)).toBe('2030-02-02');
    expect(sumarDias('2030-12-31', 1)).toBe('2031-01-01');
  });
  it('respeta años bisiestos', () => {
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });
});