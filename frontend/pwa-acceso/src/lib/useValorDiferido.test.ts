// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useValorDiferido } from './useValorDiferido';

describe('useValorDiferido', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arranca con el valor inicial', () => {
    const { result } = renderHook(() => useValorDiferido('ana', 300));
    expect(result.current).toBe('ana');
  });

  it('entrega el valor nuevo recién cuando pasa la espera', () => {
    const { result, rerender } = renderHook(
      ({ valor }) => useValorDiferido(valor, 300),
      {
        initialProps: { valor: '' },
      }
    );

    rerender({ valor: 'pérez' });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe('');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('pérez');
  });

  it('cada cambio reinicia la espera: solo se entrega el último valor', () => {
    const { result, rerender } = renderHook(
      ({ valor }) => useValorDiferido(valor, 300),
      {
        initialProps: { valor: '' },
      }
    );

    rerender({ valor: 'p' });
    act(() => vi.advanceTimersByTime(200));
    rerender({ valor: 'pé' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe('');

    rerender({ valor: 'pérez' });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('pérez');
  });
});
