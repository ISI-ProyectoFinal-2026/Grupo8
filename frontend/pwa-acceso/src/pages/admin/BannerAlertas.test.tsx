// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
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

  it('los incidentes se anuncian como alerta', async () => {
    vi.mocked(listarAlertas).mockResolvedValue([alerta('id-1', 'Ana Pérez')]);

    renderizar();

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /1 incidente de acceso sin resolver/
    );
  });

  it('si no se pueden consultar las alertas lo dice, sin bloquear el inicio', async () => {
    // Lo que tira fetch cuando no llega al servidor
    vi.mocked(listarAlertas).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    );

    renderizar();

    const aviso = await screen.findByText(
      /No se pudieron consultar las alertas de acceso/
    );
    expect(aviso.textContent).toBe(
      'No se pudieron consultar las alertas de acceso. No se pudo conectar con el servidor.'
    );
    expect(aviso.closest('[role="status"]')).toBeTruthy();
  });

  // Que el monitor de ocupación no salte cuando llega la respuesta (CLS)
  it('reserva el mismo alto mínimo mientras carga y con incidentes (26.5)', async () => {
    let responder: (valor: AlertaClonacion[]) => void = () => {};
    vi.mocked(listarAlertas).mockReturnValue(
      new Promise((resolver) => (responder = resolver))
    );

    renderizar();
    const cargando = screen.getByRole('status');
    expect(cargando.textContent).toMatch(/Revisando alertas de acceso/);
    const altoMientrasCarga = cargando.className.match(/min-h-\S+/)?.[0];

    await act(async () =>
      responder([alerta('id-1', 'Ana Pérez'), alerta('id-2', 'Luis Gómez')])
    );

    const conIncidentes = screen.getByRole('alert');
    expect(altoMientrasCarga).toBeTruthy();
    expect(conIncidentes.className.match(/min-h-\S+/)?.[0]).toBe(
      altoMientrasCarga
    );
  });
});