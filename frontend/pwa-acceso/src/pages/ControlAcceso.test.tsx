// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { dbService } from '../services/dbService';
import type { IJwtPayload } from '../types/security';
import { verificarQR } from '../utils/security';
import { diaEnArgentina } from '../utils/vigenciaQR';
import ControlAcceso from './ControlAcceso';

// La pantalla vive dentro del router de la app
const renderizar = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

// La sincronización de fondo y la cámara no son lo que se prueba acá
vi.mock('../services/syncService', () => ({ syncService: { iniciarBackgroundSync: vi.fn() } }));
// La cámara se reemplaza por un botón que "escanea" un QR de prueba
vi.mock('../components/ScannerQR', () => ({
  ScannerQR: ({ onScanSuccess }: { onScanSuccess: (token: string) => void }) => (
    <button onClick={() => onScanSuccess('qr-de-prueba')}>Leer código de prueba</button>
  ),
}));
// La firma del QR se prueba en accessValidationService; acá interesa qué pasa después
vi.mock('../utils/security', () => ({ verificarQR: vi.fn() }));

const bootstrapCon = (capacidad: number) => ({
  ok: true,
  json: async () => ({ configuracion: { capacidad_maxima: capacidad } }),
});
const sinRed = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

const botonEscanear = () => screen.getByRole('button', { name: /Escanear QR|CAMPING LLENO/ }) as HTMLButtonElement;

describe('ControlAcceso — capacidad real y arranque en frío (Issue 16.5)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
  });

  it('arranque en frío sin red: avisa al guardia, no inventa un valor y no bloquea la app', async () => {
    vi.stubGlobal('fetch', sinRed());

    renderizar(<ControlAcceso />);

    expect(await screen.findByText('Capacidad no disponible')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText('/ 500')).toBeNull();
    expect(botonEscanear().disabled).toBe(false);
  });

  it('con conexión muestra la capacidad que informa el servidor y la guarda', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootstrapCon(50)));

    renderizar(<ControlAcceso />);

    expect(await screen.findByText('/ 50')).toBeTruthy();
    expect(screen.queryByText('Capacidad no disponible')).toBeNull();
    await waitFor(async () => expect(await dbService.obtenerCapacidadMaxima()).toBe(50));
  });

  it('sin red pero con capacidad guardada usa la guardada y no muestra el aviso', async () => {
    await dbService.guardarCapacidadMaxima(80);
    const fetchFalso = sinRed();
    vi.stubGlobal('fetch', fetchFalso);

    renderizar(<ControlAcceso />);

    expect(await screen.findByText('/ 80')).toBeTruthy();
    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(screen.queryByText('Capacidad no disponible')).toBeNull();
  });

  it('si la capacidad se conoce y está llena, bloquea los ingresos', async () => {
    await dbService.guardarCapacidadMaxima(2);
    await dbService.guardarConfiguracion('ocupacion_actual', '2');
    vi.stubGlobal('fetch', sinRed());

    renderizar(<ControlAcceso />);

    expect(await screen.findByText(/CAMPING LLENO/)).toBeTruthy();
    expect(botonEscanear().disabled).toBe(true);
  });

  it('al volver la conexión descarga la capacidad y quita el aviso', async () => {
    const fetchFalso = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(bootstrapCon(60));
    vi.stubGlobal('fetch', fetchFalso);

    renderizar(<ControlAcceso />);
    await screen.findByText('Capacidad no disponible');

    window.dispatchEvent(new Event('online'));

    expect(await screen.findByText('/ 60')).toBeTruthy();
    expect(screen.queryByText('Capacidad no disponible')).toBeNull();
  });

  it('ya no tiene el panel de pruebas QA ni simuladores de QR', async () => {
    vi.stubGlobal('fetch', sinRed());

    renderizar(<ControlAcceso />);
    await screen.findByText('Capacidad no disponible');

    expect(screen.queryByText(/Panel de Pruebas QA/)).toBeNull();
    expect(screen.queryByText(/Simular QR/)).toBeNull();
    expect(screen.queryByPlaceholderText(/N° de reserva a bloquear/)).toBeNull();
  });
});
const RESERVA_CANCELADA = '7d0c6a7e-2f4b-4c1e-9a55-0b1f2c3d4e5f';
const RESERVA_VIGENTE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const payloadDe = (reservaId: string): IJwtPayload => ({
  jti: `jti-${reservaId}`,
  reserva_id: reservaId,
  camping_id: 'CAMP-01',
  iat: 0,
  exp: 0,
  cantidad_personas: 2,
  typ: 'visitante',
  // Estadía de un día que incluye hoy: la 28.1 rechaza los QR que no sirven para el día del escaneo
  dat: diaEnArgentina(),
  egr: diaEnArgentina(),
});

const bootstrapConBlacklist = (blacklist: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    blacklist,
    configuracion: { capacidad_maxima: 50 },
    pagina_actual: 1,
    tiene_mas_paginas: false,
  }),
});

async function escanear(reservaId: string) {
  vi.mocked(verificarQR).mockResolvedValue({ ok: true, payload: payloadDe(reservaId) });
  fireEvent.click(await screen.findByRole('button', { name: /Escanear QR/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Leer código de prueba' }));
}

describe('ControlAcceso — rechazo offline de reservas canceladas (Issue 20.4)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    await db.blacklist.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    await db.blacklist.clear();
  });

  it('descarga la lista con conexión y después, sin red, rechaza el QR de una reserva cancelada', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValueOnce(bootstrapConBlacklist([RESERVA_CANCELADA]))
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchFalso);

    renderizar(<ControlAcceso />);
    await waitFor(async () => expect(await dbService.verificarAccesoRevocado(RESERVA_CANCELADA)).toBe(true));

    // Se corta la conexión: la validación usa solo lo guardado en el dispositivo
    await escanear(RESERVA_CANCELADA);

    expect(await screen.findByText(/Reserva Cancelada/)).toBeTruthy();
    expect(screen.queryByText(/INGRESO CONFIRMADO/)).toBeNull();
    expect(await db.ingresos_pendientes.count()).toBe(0);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('en un arranque sin red usa la lista guardada en la sesión anterior', async () => {
    await dbService.reemplazarBlacklist([RESERVA_CANCELADA]);
    vi.stubGlobal('fetch', sinRed());

    renderizar(<ControlAcceso />);
    await escanear(RESERVA_CANCELADA);

    expect(await screen.findByText(/Reserva Cancelada/)).toBeTruthy();
    expect(await db.ingresos_pendientes.count()).toBe(0);
  });

  it('el QR de una reserva que no está en la lista se acepta y queda para sincronizar', async () => {
    await dbService.reemplazarBlacklist([RESERVA_CANCELADA]);
    vi.stubGlobal('fetch', sinRed());

    renderizar(<ControlAcceso />);
    await escanear(RESERVA_VIGENTE);

    expect(await screen.findByText(/INGRESO CONFIRMADO/)).toBeTruthy();
    expect(screen.queryByText(/Reserva Cancelada/)).toBeNull();
    expect(await db.ingresos_pendientes.count()).toBe(1);
  });

  it('una reserva que salió de la lista del servidor vuelve a entrar', async () => {
    await dbService.reemplazarBlacklist([RESERVA_CANCELADA]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootstrapConBlacklist([])));

    renderizar(<ControlAcceso />);
    await waitFor(async () => expect(await dbService.verificarAccesoRevocado(RESERVA_CANCELADA)).toBe(false));
    await escanear(RESERVA_CANCELADA);

    expect(await screen.findByText(/INGRESO CONFIRMADO/)).toBeTruthy();
  });
});

describe('ControlAcceso — solo el escáner (26.4)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    vi.stubGlobal('fetch', sinRed());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
  });

  it('muestra el escáner, sin el formulario manual ni un botón para abrirlo', async () => {
    renderizar(<ControlAcceso />);

    expect(await screen.findByRole('button', { name: /Escanear QR|CAMPING LLENO/ })).toBeTruthy();
    expect(screen.queryByLabelText(/DNI \/ Pasaporte/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ingreso Manual/ })).toBeNull();
  });
});

describe('ControlAcceso — foco al abrir y cerrar el escáner (27.4)', () => {
  beforeEach(async () => {
    await db.configuracion.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', sinRed());
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
  });

  it('al abrir el escáner el foco va a la indicación, y al leer un código vuelve a "Escanear QR"', async () => {
    vi.mocked(verificarQR).mockResolvedValue({ ok: false, motivo: 'FIRMA_INVALIDA' });
    renderizar(<ControlAcceso />);

    fireEvent.click(await screen.findByRole('button', { name: /Escanear QR/ }));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Apunte al código del visitante' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Leer código de prueba' }));

    // El resultado se anuncia solo y el guardia queda listo para el próximo visitante
    expect((await screen.findByRole('alert')).textContent).toContain('Acceso Denegado');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Escanear QR/ }))
    );
  });

  it('"Cancelar" cierra el escáner y devuelve el foco a "Escanear QR"', async () => {
    renderizar(<ControlAcceso />);

    fireEvent.click(await screen.findByRole('button', { name: /Escanear QR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /Escanear QR/ }))
    );
  });
});

describe('ControlAcceso — QR fuera de fecha, aun sin internet (Issue 28.1)', () => {
  // Estadía del 27 al 29/11/2026. Se simula solo Date: Dexie y fake-indexeddb necesitan los timers reales
  const ESTADIA = { dat: '2026-11-27', egr: '2026-11-29' };
  const MENSAJE = 'Este QR no es válido para hoy';

  beforeEach(async () => {
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.blacklist.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubGlobal('fetch', sinRed()); // sin internet
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.configuracion.clear();
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.blacklist.clear();
  });

  async function escanearEn(momento: string, qr: Awaited<ReturnType<typeof verificarQR>>) {
    vi.setSystemTime(new Date(momento));
    vi.mocked(verificarQR).mockResolvedValue(qr);
    renderizar(<ControlAcceso />);
    fireEvent.click(await screen.findByRole('button', { name: /Escanear QR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Leer código de prueba' }));
  }
  const qrDeLaEstadia = (): Awaited<ReturnType<typeof verificarQR>> => ({
    ok: true,
    payload: { ...payloadDe('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'), ...ESTADIA },
  });

  // Las horas son de Buenos Aires (-03:00)
  it.each([
    ['día anterior', '2026-11-26T23:59:59-03:00'],
    ['día posterior', '2026-11-30T00:00:00-03:00'],
    ['día anterior a las 22:30 (en UTC ya es el 27/11)', '2026-11-26T22:30:00-03:00'],
  ])('%s: muestra el mensaje y no guarda nada', async (_nombre, momento) => {
    await escanearEn(momento, qrDeLaEstadia());

    expect((await screen.findByRole('alert')).textContent).toContain(MENSAJE);
    expect(screen.queryByText(/INGRESO CONFIRMADO/)).toBeNull();
    // Ni en la cola de sincronización ni en el historial del guardia
    expect(await db.ingresos_pendientes.count()).toBe(0);
    expect(await db.historial.count()).toBe(0);
    expect(await dbService.obtenerOcupacion()).toBe(0);
  });

  it.each([
    ['primer día', '2026-11-27T00:00:00-03:00'],
    ['último día', '2026-11-29T23:59:59-03:00'],
    ['último día a las 22:30 (en UTC ya es el 30/11)', '2026-11-29T22:30:00-03:00'],
  ])('%s: acepta el ingreso y lo deja para sincronizar', async (_nombre, momento) => {
    await escanearEn(momento, qrDeLaEstadia());

    expect(await screen.findByText(/INGRESO CONFIRMADO/)).toBeTruthy();
    expect(screen.queryByText(MENSAJE)).toBeNull();
    expect(await db.ingresos_pendientes.count()).toBe(1);
    expect(await db.historial.count()).toBe(1);
  });

  it('un QR auténtico pero vencido (exp ya pasó) muestra el mismo mensaje y no guarda nada', async () => {
    await escanearEn('2026-12-05T12:00:00-03:00', { ok: false, motivo: 'VENCIDO' });

    expect((await screen.findByRole('alert')).textContent).toContain(MENSAJE);
    expect(await db.ingresos_pendientes.count()).toBe(0);
    expect(await db.historial.count()).toBe(0);
  });

  it('un QR falso sigue mostrando "Código QR inválido", no el mensaje de fecha', async () => {
    await escanearEn('2026-11-28T12:00:00-03:00', { ok: false, motivo: 'FIRMA_INVALIDA' });

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Código QR inválido');
    expect(alerta.textContent).not.toContain(MENSAJE);
  });
});
