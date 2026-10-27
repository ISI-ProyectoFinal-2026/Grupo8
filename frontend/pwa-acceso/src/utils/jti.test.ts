import { describe, expect, it } from 'vitest';
import { generarJti } from './jti';

describe('generarJti', () => {
  it('genera ids únicos aunque se pidan en el mismo milisegundo', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generarJti('manual')));
    expect(ids.size).toBe(1000);
  });

  it('tiene prefijo y un UUID v4 válido', () => {
    expect(generarJti('manual')).toMatch(
      /^manual-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});