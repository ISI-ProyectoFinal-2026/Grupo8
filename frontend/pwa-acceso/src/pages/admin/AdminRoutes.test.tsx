// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { AuthProvider, TOKEN_KEY } from '@/context/AuthContext';
import AdminRoutes from './AdminRoutes';

// ControlAcceso arrastra Dexie/IndexedDB, jose y html5-qrcode; no es parte
// de este flujo, así que se aísla.
vi.mock('../ControlAcceso', () => ({ default: () => null }));

const NOMBRE_NAV = /navegación del panel de administración/i;

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`.
function crearToken(rol: string, exp = Math.floor(Date.now() / 1000) + 3600) {
  const cabecera = base64Url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64Url({ sub: 'usuario-1', rol, exp });
  return `${cabecera}.${payload}.firma`;
}

function renderizarEn(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AuthProvider>
        <Routes>
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route path="/login" element={<p>Pantalla de login</p>} />
          <Route path="/" element={<p>Inicio público</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Shell del panel de administración (Issue 15.1)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  describe('con sesión ADMIN', () => {
    beforeEach(() => localStorage.setItem(TOKEN_KEY, crearToken('ADMIN')));

    it.each([
      ['/admin', 'Inicio'],
      ['/admin/socios', 'Socios'],
      ['/admin/descuentos', 'Descuentos'],
      ['/admin/incidentes', 'Incidentes'],
      ['/admin/ocupacion', 'Ocupación'],
    ])('renderiza %s con su página inicial', (ruta, titulo) => {
      renderizarEn(ruta);

      expect(
        screen.getByRole('heading', { level: 1, name: titulo })
      ).toBeTruthy();
    });

    it('muestra el layout común con un enlace por cada sección', () => {
      renderizarEn('/admin/socios');

      const nav = screen.getByRole('navigation', { name: NOMBRE_NAV });
      const hrefs = within(nav)
        .getAllByRole('link')
        .map((enlace) => enlace.getAttribute('href'));

      expect(hrefs).toEqual([
        '/admin',
        '/admin/socios',
        '/admin/descuentos',
        '/admin/incidentes',
        '/admin/ocupacion',
      ]);
    });

    it('marca como activa solo la sección actual', () => {
      renderizarEn('/admin/descuentos');

      const nav = screen.getByRole('navigation', { name: NOMBRE_NAV });
      const activos = within(nav)
        .getAllByRole('link')
        .filter((enlace) => enlace.getAttribute('aria-current') === 'page');

      expect(activos).toHaveLength(1);
      expect(activos[0].textContent).toMatch(/descuentos/i);
    });

    it('redirige una ruta inexistente al inicio del panel', () => {
      renderizarEn('/admin/no-existe');

      expect(
        screen.getByRole('heading', { level: 1, name: 'Inicio' })
      ).toBeTruthy();
    });
  });

  describe('protección por rol', () => {
    it('sin sesión redirige a /login y no muestra el panel', () => {
      renderizarEn('/admin/socios');

      expect(screen.getByText('Pantalla de login')).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: NOMBRE_NAV })).toBeNull();
    });

    it.each(['CLIENTE', 'SEGURIDAD'])(
      'el rol %s no accede al panel y ve "Acceso denegado"',
      (rol) => {
        localStorage.setItem(TOKEN_KEY, crearToken(rol));

        renderizarEn('/admin/incidentes');

        expect(
          screen.getByRole('heading', { level: 1, name: /acceso denegado/i })
        ).toBeTruthy();
        expect(
          screen.queryByRole('navigation', { name: NOMBRE_NAV })
        ).toBeNull();
      }
    );

    it('un token vencido se descarta y redirige a /login', () => {
      const ayer = Math.floor(Date.now() / 1000) - 86400;
      localStorage.setItem(TOKEN_KEY, crearToken('ADMIN', ayer));

      renderizarEn('/admin');

      expect(screen.getByText('Pantalla de login')).toBeTruthy();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('un token ilegible redirige a /login', () => {
      localStorage.setItem(TOKEN_KEY, 'no-es-un-jwt');

      renderizarEn('/admin');

      expect(screen.getByText('Pantalla de login')).toBeTruthy();
    });
  });

  describe('integración con App', () => {
    it('/admin sin sesión muestra el login', () => {
      window.history.pushState({}, '', '/admin');

      render(<App />);

      expect(screen.getByLabelText(/dni o email/i)).toBeTruthy();
    });

    it('el panel no muestra el encabezado ni el pie de la web de reservas', () => {
      localStorage.setItem(TOKEN_KEY, crearToken('ADMIN'));
      window.history.pushState({}, '', '/admin/socios');

      render(<App />);

      expect(screen.queryByRole('link', { name: /^beneficios$/i })).toBeNull();
      expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeTruthy();
    });

    it('la web de reservas sigue mostrando su encabezado', () => {
      window.history.pushState({}, '', '/beneficios');

      render(<App />);

      expect(
        screen.getAllByRole('link', { name: /^beneficios$/i }).length
      ).toBeGreaterThan(0);
    });

    it('/admin/socios con sesión ADMIN muestra el panel', () => {
      localStorage.setItem(TOKEN_KEY, crearToken('ADMIN'));
      window.history.pushState({}, '', '/admin/socios');

      render(<App />);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Socios' })
      ).toBeTruthy();
    });
  });
});