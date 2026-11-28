// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { dbService } from '@/services/dbService';
import {
  AUTH_EXPIRED_EVENT,
  AuthProvider,
  leerTokenGuardia,
  MENSAJE_SESION_VENCIDA,
  TOKEN_KEY,
  useAuth,
} from './AuthContext';

function base64Url(objeto: object) {
  return btoa(JSON.stringify(objeto))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// JWT sin firma válida: la interfaz solo lee los claims `rol` y `exp`
function crearToken(
  rol = 'SEGURIDAD',
  exp = Math.floor(Date.now() / 1000) + 3600
) {
  const payload = base64Url({ sub: 'u-1', rol, exp });
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${payload}.firma`;
}

const AYER = () => Math.floor(Date.now() / 1000) - 86400;

function simularConexion(enLinea: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => enLinea,
  });
}

/** Muestra lo que expone el contexto, para probarlo sin depender de ninguna pantalla. */
function Sonda({ tokenParaLogin }: { tokenParaLogin?: string }) {
  const {
    rol,
    cargando,
    sesionVencidaOffline,
    avisoSesion,
    cerrarSesion,
    iniciarSesion,
  } = useAuth();
  return (
    <div>
      <p data-testid="estado">
        {cargando ? 'cargando' : (rol ?? 'sin-sesion')}
      </p>
      <p data-testid="vencida-offline">{sesionVencidaOffline ? 'si' : 'no'}</p>
      <p data-testid="aviso">{avisoSesion ?? ''}</p>
      <button onClick={cerrarSesion}>Salir</button>
      {tokenParaLogin && (
        <button onClick={() => iniciarSesion(tokenParaLogin)}>Entrar</button>
      )}
    </div>
  );
}

function mostrar(tokenParaLogin?: string) {
  return render(
    <AuthProvider>
      <Sonda tokenParaLogin={tokenParaLogin} />
    </AuthProvider>
  );
}

const estado = () => screen.getByTestId('estado').textContent;

async function limpiarTodo() {
  await db.configuracion.clear();
  await db.ingresos_pendientes.clear();
  await db.historial.clear();
  localStorage.clear();
}

describe('AuthProvider: sesión del guardia en IndexedDB (28.2)', () => {
  beforeEach(async () => {
    simularConexion(true);
    await limpiarTodo();
  });
  afterEach(async () => {
    cleanup();
    simularConexion(true);
    await limpiarTodo();
  });

  describe('reapertura de la app', () => {
    it('sin conexión y con el token vigente, entra directo sin pedir login', async () => {
      simularConexion(false);
      await dbService.guardarSesion(crearToken('SEGURIDAD'), 'SEGURIDAD');

      mostrar();

      // Mientras lee IndexedDB todavía no sabe si hay sesión: no manda al login
      expect(estado()).toBe('cargando');
      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      expect(screen.getByTestId('vencida-offline').textContent).toBe('no');
      expect(screen.getByTestId('aviso').textContent).toBe('');
    });

    it('con conexión y con el token vigente, también entra directo', async () => {
      await dbService.guardarSesion(crearToken('SEGURIDAD'), 'SEGURIDAD');

      mostrar();

      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      expect(screen.getByTestId('vencida-offline').textContent).toBe('no');
    });

    it('sin conexión y con el token vencido, conserva la sesión y marca que está vencida', async () => {
      simularConexion(false);
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', AYER()),
        'SEGURIDAD'
      );

      mostrar();

      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      expect(screen.getByTestId('vencida-offline').textContent).toBe('si');
      // No se borra nada: el guardia sigue trabajando y se reintenta al volver la red
      expect(await dbService.obtenerSesion()).not.toBeNull();
    });

    it('con conexión y con el token vencido, limpia la sesión y avisa por qué', async () => {
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', AYER()),
        'SEGURIDAD'
      );

      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      expect(screen.getByTestId('aviso').textContent).toBe(
        MENSAJE_SESION_VENCIDA
      );
      expect(await dbService.obtenerSesion()).toBeNull();
    });

    it('un token vencido con conexión no borra los ingresos pendientes', async () => {
      await dbService.registrarIngresoManual(
        '30111222',
        'Ana',
        0,
        'Espontaneo',
        100
      );
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', AYER()),
        'SEGURIDAD'
      );

      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      expect(await db.ingresos_pendientes.count()).toBe(1);
    });

    it('si lo guardado no es un token utilizable, no hay sesión y no se avisa nada', async () => {
      await dbService.guardarSesion('esto-no-es-un-jwt', 'SEGURIDAD');

      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      expect(screen.getByTestId('aviso').textContent).toBe('');
      expect(await dbService.obtenerSesion()).toBeNull();
    });

    it('un token guardado de otro rol no abre la sesión del guardia', async () => {
      await dbService.guardarSesion(crearToken('CLIENTE'), 'SEGURIDAD');

      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      expect(await dbService.obtenerSesion()).toBeNull();
    });

    it('sin nada guardado, queda sin sesión (y deja de cargar)', async () => {
      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
    });

    it('un guardia que ya tenía sesión en localStorage (versión anterior) no se desloguea: se pasa a IndexedDB', async () => {
      simularConexion(false);
      const token = crearToken('SEGURIDAD');
      localStorage.setItem(TOKEN_KEY, token);

      mostrar();

      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      expect((await dbService.obtenerSesion())?.token).toBe(token);
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });
  });

  describe('sesiones de la web y del panel', () => {
    it('la de un socio sigue en localStorage y está disponible desde el primer render', () => {
      localStorage.setItem(TOKEN_KEY, crearToken('CLIENTE'));

      mostrar();

      expect(estado()).toBe('CLIENTE');
    });

    it('iniciar sesión como socio guarda en localStorage y no en IndexedDB', async () => {
      const token = crearToken('CLIENTE');
      mostrar(token);
      await waitFor(() => expect(estado()).toBe('sin-sesion'));

      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

      await waitFor(() => expect(estado()).toBe('CLIENTE'));
      expect(localStorage.getItem(TOKEN_KEY)).toBe(token);
      expect(await dbService.obtenerSesion()).toBeNull();
    });

    it('un token vencido de un socio se descarta, aunque no haya conexión', async () => {
      simularConexion(false);
      localStorage.setItem(TOKEN_KEY, crearToken('CLIENTE', AYER()));

      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });
  });

  describe('iniciar sesión como guardia', () => {
    it('guarda token y rol en IndexedDB, y no deja copia en localStorage', async () => {
      const token = crearToken('SEGURIDAD');
      mostrar(token);
      await waitFor(() => expect(estado()).toBe('sin-sesion'));

      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      await waitFor(async () =>
        expect((await dbService.obtenerSesion())?.token).toBe(token)
      );
      expect((await dbService.obtenerSesion())?.rol).toBe('SEGURIDAD');
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(await leerTokenGuardia()).toBe(token);
    });

    it('el login del guardia le saca el aviso de sesión vencida', async () => {
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', AYER()),
        'SEGURIDAD'
      );
      const nuevo = crearToken('SEGURIDAD');
      mostrar(nuevo);
      await waitFor(() =>
        expect(screen.getByTestId('aviso').textContent).toBe(
          MENSAJE_SESION_VENCIDA
        )
      );

      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      expect(screen.getByTestId('aviso').textContent).toBe('');
    });
  });

  describe('cerrar sesión (voluntario)', () => {
    it('borra el token de IndexedDB y conserva los ingresos pendientes y el historial', async () => {
      await dbService.registrarIngresoManual(
        '30111222',
        'Ana',
        1,
        'Espontaneo',
        100
      );
      await dbService.registrarIngresoManual(
        '30111223',
        'Beto',
        0,
        'Espontaneo',
        50
      );
      await dbService.guardarSesion(crearToken('SEGURIDAD'), 'SEGURIDAD');
      const pendientesAntes = await db.ingresos_pendientes.toArray();
      const historialAntes = await db.historial.toArray();
      mostrar();
      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));

      fireEvent.click(screen.getByRole('button', { name: 'Salir' }));

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      await waitFor(async () =>
        expect(await dbService.obtenerSesion()).toBeNull()
      );
      expect(await db.ingresos_pendientes.toArray()).toEqual(pendientesAntes);
      expect(await db.historial.toArray()).toEqual(historialAntes);
    });

    it('también funciona sin conexión y con el token vencido', async () => {
      simularConexion(false);
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', AYER()),
        'SEGURIDAD'
      );
      mostrar();
      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));

      fireEvent.click(screen.getByRole('button', { name: 'Salir' }));

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      await waitFor(async () =>
        expect(await dbService.obtenerSesion()).toBeNull()
      );
    });

    it('al reabrir después de cerrar sesión, no vuelve a entrar', async () => {
      await dbService.guardarSesion(crearToken('SEGURIDAD'), 'SEGURIDAD');
      const primera = mostrar();
      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));
      fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
      await waitFor(async () =>
        expect(await dbService.obtenerSesion()).toBeNull()
      );
      primera.unmount();

      mostrar();

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
    });
  });

  describe('el servidor rechaza el token (401 de syncService)', () => {
    it('limpia la sesión de IndexedDB, muestra el aviso y conserva los ingresos pendientes', async () => {
      await dbService.registrarIngresoManual(
        '30111222',
        'Ana',
        0,
        'Espontaneo',
        100
      );
      await dbService.guardarSesion(crearToken('SEGURIDAD'), 'SEGURIDAD');
      mostrar();
      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));

      act(() => {
        window.dispatchEvent(
          new CustomEvent(AUTH_EXPIRED_EVENT, {
            detail: { mensaje: 'Iniciá sesión de nuevo.' },
          })
        );
      });

      await waitFor(() => expect(estado()).toBe('sin-sesion'));
      expect(screen.getByTestId('aviso').textContent).toBe(
        'Iniciá sesión de nuevo.'
      );
      await waitFor(async () =>
        expect(await dbService.obtenerSesion()).toBeNull()
      );
      expect(await db.ingresos_pendientes.count()).toBe(1);
    });
  });

  describe('el token vence con la app abierta', () => {
    it('sin conexión, el aviso aparece solo cuando llega el exp, sin recargar', async () => {
      simularConexion(false);
      // Vence dentro de 1 segundo o menos (el exp va en segundos enteros)
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', Math.floor(Date.now() / 1000) + 1),
        'SEGURIDAD'
      );
      mostrar();
      await waitFor(() => expect(estado()).toBe('SEGURIDAD'));

      await waitFor(
        () =>
          expect(screen.getByTestId('vencida-offline').textContent).toBe('si'),
        { timeout: 4000 }
      );
    });

    it('si vuelve la conexión, el aviso de sesión vencida sin red desaparece', async () => {
      simularConexion(false);
      await dbService.guardarSesion(
        crearToken('SEGURIDAD', AYER()),
        'SEGURIDAD'
      );
      mostrar();
      await waitFor(() =>
        expect(screen.getByTestId('vencida-offline').textContent).toBe('si')
      );

      simularConexion(true);
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(screen.getByTestId('vencida-offline').textContent).toBe('no');
    });
  });
});

describe('leerTokenGuardia (28.2)', () => {
  beforeEach(limpiarTodo);
  afterEach(limpiarTodo);

  it('sin sesión devuelve null', async () => {
    expect(await leerTokenGuardia()).toBeNull();
  });

  it('con sesión devuelve el token guardado', async () => {
    await dbService.guardarSesion('token-del-guardia', 'SEGURIDAD');
    expect(await leerTokenGuardia()).toBe('token-del-guardia');
  });
});
