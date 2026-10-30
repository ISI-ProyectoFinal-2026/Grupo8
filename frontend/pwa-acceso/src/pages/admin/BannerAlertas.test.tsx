// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BannerAlertas } from './BannerAlertas';
import { listarAlertas, type AlertaClonacion } from '@/services/alertasService';

vi.mock('@/services/alertasService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/alertasService')>();
  return { ...original, listarAlertas: vi.fn(), resolverAlerta: vi.fn() };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ token: 'token-de-prueba' }) }));

const alerta = (reservaId: string, titular: string): AlertaClonacion => ({
  reserva_id: reservaId,
  titular,
  fecha_ingreso: '2026-10-29',
  fecha_alerta_clonacion: '2026-10-29T18:30:00+00:00',
});

const renderizar = () =>
  render(
    <MemoryRouter>
      <BannerAlertas />
    </MemoryRouter>
  );

describe('Banner de alertas en la vista principal', () => {
  beforeEach(() => vi.mocked(listarAlertas).mockReset());
  afterEach(() => cleanup());

  it('advierte cuántos incidentes hay y enlaza al panel', async () => {
    vi.mocked(listarAlertas).mockResolvedValue([alerta('id-1', 'Ana Pérez'), alerta('id-2', 'Luis Gómez')]);

    renderizar();

    expect(await screen.findByText(/2 incidentes de acceso sin resolver/)).toBeTruthy();
    expect(screen.getByText(/titular Ana Pérez/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver alertas' }).getAttribute('href')).toBe('/admin/alertas');
  });

  it('muestra un mensaje tranquilo cuando no hay incidentes', async () => {
    vi.mocked(listarAlertas).mockResolvedValue([]);

    renderizar();

    expect(await screen.findByText(/Sin incidentes de acceso pendientes/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ver alertas' })).toBeNull();
  });
});