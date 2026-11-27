// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { CartelContacto } from './CartelContacto';

function mostrar() {
  render(
    <MemoryRouter initialEntries={['/origen']}>
      <Routes>
        <Route path="/origen" element={<CartelContacto />} />
        <Route path="/contacto" element={<h1>Pantalla Contacto</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Cartel "¿No te llegó el mail? Contactanos" (31.3)', () => {
  afterEach(cleanup);

  it('muestra el mensaje completo', () => {
    mostrar();

    expect(screen.getByText('¿No te llegó el mail?')).toBeTruthy();
    expect(screen.getByText('Contactanos', { exact: false })).toBeTruthy();
  });

  it('es una región con nombre, para que el lector de pantalla la anuncie con su texto', () => {
    mostrar();

    const region = screen.getByRole('complementary', { name: /no te llegó el mail\? contactanos/i });
    expect(region).toBeTruthy();
  });

  it('el enlace lleva a la pantalla Contacto y su nombre dice a dónde lleva', () => {
    mostrar();

    const enlace = screen.getByRole('link', { name: /contactanos/i });
    expect(enlace.getAttribute('href')).toBe('/contacto');
    expect(enlace.textContent).toContain('abre la pantalla de contacto del camping');
  });

  it('al activar el enlace se abre la ruta /contacto', () => {
    mostrar();

    fireEvent.click(screen.getByRole('link', { name: /contactanos/i }));

    expect(screen.getByRole('heading', { name: 'Pantalla Contacto' })).toBeTruthy();
  });

  it('el enlace entra en el orden del teclado y tiene indicador de foco visible', () => {
    mostrar();
    const enlace = screen.getByRole('link', { name: /contactanos/i });

    enlace.focus();

    expect(document.activeElement).toBe(enlace);
    // Sin tabindex negativo: se alcanza con Tab. El anillo de foco es el mismo que usan los botones
    expect(enlace.getAttribute('tabindex')).toBeNull();
    expect(enlace.className).toContain('focus-visible:ring-2');
  });

  it('no transmite el mensaje solo con color: el enlace va subrayado y el texto es visible', () => {
    mostrar();

    expect(screen.getByRole('link', { name: /contactanos/i }).className).toContain('underline');
    expect(screen.getByText('¿No te llegó el mail?').className).toContain('font-semibold');
  });
});
