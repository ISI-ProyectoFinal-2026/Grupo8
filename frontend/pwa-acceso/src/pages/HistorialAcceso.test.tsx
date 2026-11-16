// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HistorialAcceso from './HistorialAcceso';

describe('Historial de la app del guardia (vista de la 24.5)', () => {
  afterEach(cleanup);

  it('muestra el título y avisa que el historial llega en una próxima versión', () => {
    render(<HistorialAcceso />);

    expect(screen.getByRole('heading', { level: 1, name: 'Historial' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Próximamente' })).toBeTruthy();
    expect(screen.getByText(/últimos ingresos registrados en este dispositivo/)).toBeTruthy();
  });
});
