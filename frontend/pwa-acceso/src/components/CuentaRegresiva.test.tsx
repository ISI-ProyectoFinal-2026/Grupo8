// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CuentaRegresiva } from './CuentaRegresiva';

const AHORA = new Date('2026-11-10T17:00:00.000Z');

describe('CuentaRegresiva (Issue 17.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('muestra los minutos y segundos que faltan para el vencimiento', () => {
    render(<CuentaRegresiva vencimiento="2026-11-10T17:10:00.000Z" />);

    expect(screen.getByRole('timer').textContent).toBe('10:00');
  });

  it('descuenta a medida que pasa el tiempo', () => {
    render(<CuentaRegresiva vencimiento="2026-11-10T17:10:00.000Z" />);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(screen.getByRole('timer').textContent).toBe('08:59');
  });

  it('al llegar a cero muestra 00:00 y avisa una sola vez', () => {
    const onVencido = vi.fn();
    render(<CuentaRegresiva vencimiento="2026-11-10T17:00:05.000Z" onVencido={onVencido} />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByRole('timer').textContent).toBe('00:00');
    expect(onVencido).toHaveBeenCalledTimes(1);
  });

  it('si el vencimiento ya pasó, avisa enseguida', () => {
    const onVencido = vi.fn();
    render(<CuentaRegresiva vencimiento="2026-11-10T16:50:00.000Z" onVencido={onVencido} />);

    expect(screen.getByRole('timer').textContent).toBe('00:00');
    expect(onVencido).toHaveBeenCalledTimes(1);
  });

  it('entiende el vencimiento en UTC aunque el navegador esté en otra zona', () => {
    // El backend lo manda con "+00:00": son las 17:10 UTC, las 14:10 en Argentina
    render(<CuentaRegresiva vencimiento="2026-11-10T17:10:00+00:00" />);

    expect(screen.getByRole('timer').textContent).toBe('10:00');
  });
});
