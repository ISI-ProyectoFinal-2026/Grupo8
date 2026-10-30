// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Alertas } from './Alertas';
import {
  AlertasApiError,
  listarAlertas,
  resolverAlerta,
  type AlertaClonacion,
} from '@/services/alertasService';

// Se reemplazan solo las llamadas a la red; la clase de error y mensajeDeError son los reales
vi.mock('@/services/alertasService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/alertasService')>();
  return { ...original, listarAlertas: vi.fn(), resolverAlerta: vi.fn() };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ token: 'token-de-prueba' }) }));

const ANA: AlertaClonacion = {
  reserva_id: '11111111-aaaa-bbbb-cccc-000000000001',
  titular: 'Ana Pérez',
  fecha_ingreso: '2026-10-29',
  fecha_alerta_clonacion: '2026-10-29T18:30:00+00:00',
};
const LUIS: AlertaClonacion = {
  reserva_id: '22222222-aaaa-bbbb-cccc-000000000002',
  titular: 'Luis Gómez',
  fecha_ingreso: '2026-10-30',
  fecha_alerta_clonacion: '2026-10-29T19:00:00+00:00',
};

const TEXTO_ANA = /Intento de múltiple ingreso detectado para el titular Ana Pérez/;
const TEXTO_LUIS = /Intento de múltiple ingreso detectado para el titular Luis Gómez/;

const renderizar = () =>
  render(
    <MemoryRouter>
      <Alertas />
    </MemoryRouter>
  );

describe('Panel de alertas de clonación', () => {
  beforeEach(() => {
    vi.mocked(listarAlertas).mockReset();
    vi.mocked(resolverAlerta).mockReset();
  });
  afterEach(() => cleanup());

  it('muestra titular y reserva de cada incidente', async () => {
    vi.mocked(listarAlertas).mockResolvedValue([ANA, LUIS]);

    renderizar();

    expect(await screen.findByText(TEXTO_ANA)).toBeTruthy();
    expect(screen.getByText(TEXTO_LUIS)).toBeTruthy();
    expect(screen.getByText(/#11111111/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Resolver incidente' })).toHaveLength(2);
  });

  it('muestra el estado vacío cuando no hay incidentes', async () => {
    vi.mocked(listarAlertas).mockResolvedValue([]);

    renderizar();

    expect(await screen.findByText(/No hay incidentes pendientes/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resolver incidente' })).toBeNull();
  });

  it('muestra "cargando" mientras espera la respuesta', () => {
    vi.mocked(listarAlertas).mockReturnValue(new Promise(() => {}));

    renderizar();

    expect(screen.getByText('Cargando alertas…')).toBeTruthy();
  });

  it('muestra el error y permite reintentar', async () => {
    vi.mocked(listarAlertas)
      .mockRejectedValueOnce(new AlertasApiError(500, 'Error interno'))
      .mockResolvedValueOnce([]);

    renderizar();

    expect(await screen.findByText('Error interno')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText(/No hay incidentes pendientes/)).toBeTruthy();
  });

  it('resuelve un incidente con confirmación y lo quita del listado', async () => {
    vi.mocked(listarAlertas).mockResolvedValueOnce([ANA, LUIS]).mockResolvedValueOnce([LUIS]);
    vi.mocked(resolverAlerta).mockResolvedValue({
      reserva_id: ANA.reserva_id,
      estado_restaurado: 'Confirmada',
      resuelto_por_id: 'admin-1',
      resuelto_por_nombre: 'Admin',
      fecha_resolucion: '2026-10-29T20:00:00+00:00',
    });

    renderizar();
    await screen.findByText(TEXTO_ANA);

    fireEvent.click(screen.getAllByRole('button', { name: 'Resolver incidente' })[0]);
    fireEvent.change(screen.getByLabelText('Nota (opcional)'), {
      target: { value: 'Se verificó en la puerta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }));

    await waitFor(() => expect(screen.queryByText(TEXTO_ANA)).toBeNull());
    expect(resolverAlerta).toHaveBeenCalledWith(
      'token-de-prueba',
      ANA.reserva_id,
      'Se verificó en la puerta'
    );
    expect(screen.getByText(TEXTO_LUIS)).toBeTruthy();
    expect(screen.getByText('Incidente de Ana Pérez resuelto.')).toBeTruthy();
  });

  it('si otro administrador ya lo resolvió (409), avisa y actualiza el listado', async () => {
    vi.mocked(listarAlertas).mockResolvedValueOnce([ANA]).mockResolvedValueOnce([]);
    vi.mocked(resolverAlerta).mockRejectedValue(new AlertasApiError(409, 'La reserva no está en alerta.'));

    renderizar();
    await screen.findByText(TEXTO_ANA);

    fireEvent.click(screen.getByRole('button', { name: 'Resolver incidente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar resolución' }));

    expect(await screen.findByText(/ya había sido resuelto por otro administrador/)).toBeTruthy();
    expect(await screen.findByText(/No hay incidentes pendientes/)).toBeTruthy();
  });
});