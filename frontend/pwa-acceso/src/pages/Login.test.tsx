// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import Login from './Login';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken(rol: string) {
  const payload = base64Url({ sub: 'u-1', rol, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

function mostrar() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/perfil" element={<p>Pantalla perfil</p>} />
          <Route path="/acceso" element={<p>Pantalla acceso</p>} />
          <Route path="/admin" element={<p>Pantalla admin</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

function completarYEnviar(identificador = '41234567', password = 'clave1234') {
  fireEvent.change(screen.getByLabelText(/dni o email/i), { target: { value: identificador } });
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));
}

describe('Login real (Issue 15.2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('no muestra "Registrarme" ni "¿Olvidaste tu contraseña?"', () => {
    mostrar();

    expect(screen.queryByText(/registrarme/i)).toBeNull();
    expect(screen.queryByText(/olvidaste/i)).toBeNull();
  });

  it('envía el identificador y la contraseña a POST /auth/login', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(respuesta(200, { access_token: crearToken('CLIENTE') }));
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();
    completarYEnviar('  ana@correo.com ', 'clave1234');
    await screen.findByText('Pantalla perfil');

    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(String(url).endsWith('/auth/login')).toBe(true);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({
      identificador: 'ana@correo.com',
      password: 'clave1234',
    });
  });

  it.each([
    ['CLIENTE', 'Pantalla perfil'],
    ['SEGURIDAD', 'Pantalla acceso'],
    ['ADMIN', 'Pantalla admin'],
  ])('un login correcto de %s guarda la sesión y redirige a su pantalla', async (rol, pantalla) => {
    const token = crearToken(rol);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, { access_token: token })));

    mostrar();
    completarYEnviar();

    await screen.findByText(pantalla);
    expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
  });

  it('con credenciales incorrectas muestra un mensaje claro y no guarda sesión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(401, { detail: 'Credenciales inválidas' }))
    );

    mostrar();
    completarYEnviar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/incorrectos/i);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.getByLabelText(/dni o email/i)).toBeTruthy();
  });

  it('si no hay conexión con el servidor lo avisa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    mostrar();
    completarYEnviar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no se pudo conectar/i);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('si el servidor falla muestra un mensaje de error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(500, {})));

    mostrar();
    completarYEnviar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/error en el servidor/i);
  });

  it('rechaza un token cuyo rol no se reconoce', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(200, { access_token: crearToken('OTRO') }))
    );

    mostrar();
    completarYEnviar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no se pudo iniciar la sesión/i);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('si ya hay una sesión abierta, /login lleva directo a la pantalla del rol', () => {
    localStorage.setItem(TOKEN_KEY, crearToken('ADMIN'));

    mostrar();

    expect(screen.getByText('Pantalla admin')).toBeTruthy();
  });
});