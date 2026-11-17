// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_EXPIRED_EVENT, AuthProvider } from '@/context/AuthContext';
import LoginAcceso from './LoginAcceso';

function mostrar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginAcceso />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Login del guardia: aviso de sesión vencida (26.3)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('sin aviso no muestra nada extra', () => {
    mostrar();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('si la sesión se cerró con un mensaje, lo muestra arriba del formulario', () => {
    mostrar();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(AUTH_EXPIRED_EVENT, {
          detail: { mensaje: 'Iniciá sesión de nuevo para sincronizar.' },
        })
      );
    });

    expect(screen.getByRole('alert').textContent).toBe(
      'Iniciá sesión de nuevo para sincronizar.'
    );
  });

  it('un cierre sin mensaje (por ejemplo, desde el panel) no muestra aviso', () => {
    mostrar();

    act(() => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
