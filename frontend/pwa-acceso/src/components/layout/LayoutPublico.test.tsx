// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '@/context/AuthContext';
import { LayoutPublico } from './LayoutPublico';

function mostrar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route element={<LayoutPublico />}>
            <Route
              path="/"
              element={
                <>
                  <h1>Inicio</h1>
                  <Link to="/otra">Ir a otra pantalla</Link>
                </>
              }
            />
            <Route path="/otra" element={<h1>Otra pantalla</h1>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Marco de la web de reservas (27.2)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('el primer enlace es "Saltar al contenido" y lleva el foco al contenido principal', () => {
    mostrar();

    const saltar = screen.getAllByRole('link')[0];
    expect(saltar.textContent).toBe('Saltar al contenido');

    fireEvent.click(saltar);
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('no mueve el foco al abrir la primera pantalla', () => {
    mostrar();
    expect(document.activeElement).not.toBe(screen.getByRole('main'));
  });

  it('al cambiar de pantalla el foco pasa al contenido nuevo', () => {
    mostrar();

    fireEvent.click(screen.getByRole('link', { name: 'Ir a otra pantalla' }));

    expect(screen.getByRole('heading', { name: 'Otra pantalla' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });
});
