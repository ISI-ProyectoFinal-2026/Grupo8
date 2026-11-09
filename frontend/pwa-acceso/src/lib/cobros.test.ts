import { describe, expect, it } from 'vitest';
import { diasDelRango, hoyEnArgentina, MAX_DIAS_RANGO, rangoPorDefecto, validarRango } from './cobros';

describe('hoyEnArgentina', () => {
  it('usa el día de Buenos Aires y no el de UTC', () => {
    // 02:30 UTC del 4 son las 23:30 del 3 en Buenos Aires
    expect(hoyEnArgentina(new Date('2026-11-04T02:30:00Z'))).toBe('2026-11-03');
    expect(hoyEnArgentina(new Date('2026-11-04T15:00:00Z'))).toBe('2026-11-04');
  });
});

describe('rangoPorDefecto', () => {
  it('es la última semana, contando hoy', () => {
    expect(rangoPorDefecto(new Date('2026-11-08T15:00:00Z'))).toEqual({
      desde: '2026-11-02',
      hasta: '2026-11-08',
    });
  });

  it('cruza el cambio de mes', () => {
    expect(rangoPorDefecto(new Date('2026-11-03T15:00:00Z')).desde).toBe('2026-10-28');
  });
});

describe('diasDelRango', () => {
  it('cuenta los dos extremos', () => {
    expect(diasDelRango('2026-11-03', '2026-11-03')).toBe(1);
    expect(diasDelRango('2026-10-30', '2026-11-02')).toBe(4);
  });
});

describe('validarRango', () => {
  it('acepta un rango válido', () => {
    expect(validarRango('2026-11-01', '2026-11-08')).toBeNull();
    expect(validarRango('2026-11-08', '2026-11-08')).toBeNull();
  });

  it('pide las dos fechas', () => {
    expect(validarRango('', '2026-11-08')).toBe('Elegí las dos fechas.');
  });

  it('rechaza "desde" posterior a "hasta"', () => {
    expect(validarRango('2026-11-09', '2026-11-08')).toMatch(/posterior/);
  });

  it(`rechaza rangos de más de ${MAX_DIAS_RANGO} días`, () => {
    expect(validarRango('2026-01-01', '2026-04-02')).toBeNull(); // 92 días
    expect(validarRango('2026-01-01', '2026-04-03')).toMatch(/92 días/);
  });
});
