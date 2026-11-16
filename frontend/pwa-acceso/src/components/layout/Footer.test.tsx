// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// CAMPING se arma al importar el módulo: cada test carga el pie de nuevo con su .env
async function mostrarPie() {
  vi.resetModules();
  const { Footer } = await import('./Footer');
  return render(
    <MemoryRouter>
      <Footer />
    </MemoryRouter>
  );
}

describe('Pie de la web de reservas (24.5)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('muestra el botón de arrepentimiento, que lleva a su pantalla sin iniciar sesión', async () => {
    await mostrarPie();

    const enlace = screen.getByRole('link', { name: 'Botón de arrepentimiento' });
    expect(enlace.getAttribute('href')).toBe('/arrepentimiento');
  });

  it('muestra el nombre y los datos del camping configurados en el .env', async () => {
    vi.stubEnv('VITE_CAMPING_NOMBRE', 'Camping El Refugio');
    vi.stubEnv('VITE_CAMPING_EMAIL', 'reservas@elrefugio.com');
    vi.stubEnv('VITE_CAMPING_TELEFONO', '+54 9 260 412-3456');
    vi.stubEnv('VITE_CAMPING_DIRECCION', 'San Rafael, Mendoza');
    vi.stubEnv('VITE_CAMPING_HORARIOS', 'Lunes a sábados de 8 a 20|Domingos de 8 a 22');

    await mostrarPie();

    expect(screen.getByText(/© \d{4} Camping El Refugio/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'reservas@elrefugio.com' }).getAttribute('href')).toBe(
      'mailto:reservas@elrefugio.com'
    );
    expect(screen.getByRole('link', { name: '+54 9 260 412-3456' }).getAttribute('href')).toBe(
      'tel:+549260412-3456'
    );
    expect(screen.getByText('San Rafael, Mendoza')).toBeTruthy();
    expect(screen.getByText('Domingos de 8 a 22')).toBeTruthy();
  });

  it('no muestra las columnas de datos que no están configurados', async () => {
    vi.stubEnv('VITE_CAMPING_EMAIL', '');
    vi.stubEnv('VITE_CAMPING_TELEFONO', '');
    vi.stubEnv('VITE_CAMPING_INSTAGRAM', '');
    vi.stubEnv('VITE_CAMPING_FACEBOOK', '');
    vi.stubEnv('VITE_CAMPING_DIRECCION', '');
    vi.stubEnv('VITE_CAMPING_HORARIOS', '');

    await mostrarPie();

    expect(screen.queryByRole('heading', { name: 'Contacto' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Redes' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Dirección' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Botón de arrepentimiento' })).toBeTruthy();
  });
});
