// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { UsuarioSesion } from '@/lib/auth';
import Perfil from './Perfil';

const SOCIO: UsuarioSesion = {
  id: 'u-1',
  nombre: 'Ana Pérez',
  email: 'ana@correo.com',
  dni: '41234567',
  rol: 'CLIENTE',
  is_socio: true,
  membresia_vigente: true,
  membresia_vence: '2030-12-31',
};

// Simula a RutaSocio: entrega el usuario a la pantalla por el contexto del Outlet
function mostrar(usuario: UsuarioSesion) {
  return render(
    <MemoryRouter initialEntries={['/perfil']}>
      <Routes>
        <Route element={<Outlet context={usuario} />}>
          <Route path="/perfil" element={<Perfil />} />
          <Route path="/mis-reservas" element={<p>Pantalla mis reservas</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const valorDe = (etiqueta: RegExp) => (screen.getByLabelText(etiqueta) as HTMLInputElement).value;

describe('Perfil con datos reales (Issue 15.3)', () => {
  afterEach(() => {
    cleanup();
  });

  it('muestra los datos reales del usuario y no los de prueba', () => {
    mostrar(SOCIO);

    expect(screen.getByText('Ana Pérez')).toBeTruthy();
    expect(valorDe(/nombre completo/i)).toBe('Ana Pérez');
    expect(valorDe(/dni/i)).toBe('41234567');
    expect(valorDe(/correo electrónico/i)).toBe('ana@correo.com');
    expect(screen.queryByText('Emiliana Bianchi')).toBeNull();
    expect(screen.queryByRole('button', { name: /guardar cambios/i })).toBeNull();
  });

  it('con membresía vigente muestra el estado y la fecha de vencimiento', () => {
    mostrar(SOCIO);

    expect(screen.getByText('Membresía vigente')).toBeTruthy();
    expect(screen.getByText('Vigente hasta el 31/12/2030')).toBeTruthy();
  });

  it('con membresía vencida lo indica y muestra desde cuándo', () => {
    mostrar({ ...SOCIO, membresia_vigente: false, membresia_vence: '2020-01-01' });

    expect(screen.getByText('Membresía vencida')).toBeTruthy();
    expect(screen.getByText('Venció el 01/01/2020')).toBeTruthy();
  });

  it('si no hay fecha de vencimiento registrada lo aclara', () => {
    mostrar({ ...SOCIO, membresia_vigente: false, membresia_vence: null });

    expect(screen.getByText('Membresía vencida')).toBeTruthy();
    expect(screen.getByText('Sin fecha de vencimiento registrada')).toBeTruthy();
  });

  it('"Ver mis reservas" lleva a Mis Reservas', () => {
    mostrar(SOCIO);

    fireEvent.click(screen.getByRole('button', { name: /ver mis reservas/i }));

    expect(screen.getByText('Pantalla mis reservas')).toBeTruthy();
  });
});