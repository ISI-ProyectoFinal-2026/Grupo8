// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import { RutaSocio, useUsuarioSocio } from './RutaSocio';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken(rol: string) {
  const payload = base64Url({ sub: 'u-1', rol, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

const SOCIO = {
  id: 'u-1',
  nombre: 'Ana Pérez',
  email: 'ana@correo.com',
  dni: '41234567',
  rol: 'CLIENTE',
  is_socio: true,
  membresia_vigente: true,
  membresia_vence: '2030-12-31',
};

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

function Contenido() {
  const usuario = useUsuarioSocio();
  return <p>Hola {usuario.nombre}</p>;
}

function mostrar() {
  return render(
    <MemoryRouter initialEntries={['/privada']}>
      <AuthProvider>
        <Routes>
          <Route element={<RutaSocio />}>
            <Route path="/privada" element={<Contenido />} />
          </Route>
          <Route path="/" element={<p>Inicio</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('RutaSocio (Issue 15.3)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(TOKEN_KEY, crearToken('CLIENTE'));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('mientras consulta al backend muestra "Cargando"', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));

    mostrar();

    expect(screen.getByRole('status').textContent).toMatch(/cargando/i);
  });

  it('un socio pasa y la pantalla recibe sus datos; se consulta /auth/me con el token', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(200, SOCIO));
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();

    expect(await screen.findByText('Hola Ana Pérez')).toBeTruthy();
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(String(url).endsWith('/auth/me')).toBe(true);
    expect(opciones.headers.Authorization).toBe(`Bearer ${localStorage.getItem(TOKEN_KEY)}`);
  });

  it('un socio con la membresía vencida también pasa, para poder ver su estado', async () => {
    const vencido = { ...SOCIO, membresia_vigente: false, membresia_vence: '2020-01-01' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, vencido)));

    mostrar();

    expect(await screen.findByText('Hola Ana Pérez')).toBeTruthy();
  });

  it('quien no es socio no accede y ve el aviso', async () => {
    const noSocio = { ...SOCIO, is_socio: false, membresia_vigente: false, membresia_vence: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(200, noSocio)));

    mostrar();

    expect(await screen.findByRole('heading', { name: /solo para socios/i })).toBeTruthy();
    expect(screen.queryByText(/hola/i)).toBeNull();
  });

  it('si el servidor falla muestra el error y permite reintentar', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(respuesta(500, {}))
      .mockResolvedValueOnce(respuesta(200, SOCIO));
    vi.stubGlobal('fetch', fetchFalso);

    mostrar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no pudimos cargar/i);

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Hola Ana Pérez')).toBeTruthy();
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('si no hay conexión con el servidor lo avisa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    mostrar();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/no pudimos conectar/i);
  });
});