// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { dbService } from '../services/dbService';
import type { IJwtPayload } from '../types/security';
import { verifyQRToken } from '../utils/security';
import ControlAcceso from './ControlAcceso';

// La sincronización de fondo y la cámara no son lo que se prueba acá
vi.mock('../services/syncService', () => ({ syncService: { iniciarBackgroundSync: vi.fn() } }));
// La cámara se reemplaza por un botón que "escanea" un QR de prueba
vi.mock('../components/ScannerQR', () => ({
  ScannerQR: ({ onScanSuccess }: { onScanSuccess: (token: string) => void }) => (
    <button onClick={() => onScanSuccess('qr-de-prueba')}>Leer código de prueba</button>
  ),
}));
// La firma del QR se prueba en accessValidationService; acá interesa qué pasa después
vi.mock('../utils/security', () => ({ verifyQRToken: vi.fn() }));

const bootstrapCon = (capacidad: number) => ({
  ok: true,
  json: async () => ({ configuracion: { capacidad_maxima: capacidad } }),
});
const sinRed = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

const botonEscanear = () => screen.getByRole('button', { name: /Escanear QR|CAMPING LLENO/ }) as HTMLButtonElement;
const botonManual = () => screen.getByRole('button', { name: /Ingreso Manual/ }) as HTMLButtonElement;

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

    render(<ControlAcceso />);

    expect(await screen.findByText('Capacidad no disponible')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText('/ 500')).toBeNull();
    expect(botonEscanear().disabled).toBe(false);
    expect(botonManual().disabled).toBe(false);
  });

  it('con conexión muestra la capacidad que informa el servidor y la guarda', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootstrapCon(50)));

    render(<ControlAcceso />);

    expect(await screen.findByText('/ 50')).toBeTruthy();
    expect(screen.queryByText('Capacidad no disponible')).toBeNull();
    await waitFor(async () => expect(await dbService.obtenerCapacidadMaxima()).toBe(50));
  });

  it('sin red pero con capacidad guardada usa la guardada y no muestra el aviso', async () => {
    await dbService.guardarCapacidadMaxima(80);
    const fetchFalso = sinRed();
    vi.stubGlobal('fetch', fetchFalso);

    render(<ControlAcceso />);

    expect(await screen.findByText('/ 80')).toBeTruthy();
    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(screen.queryByText('Capacidad no disponible')).toBeNull();
  });

  it('si la capacidad se conoce y está llena, bloquea los ingresos', async () => {
    await dbService.guardarCapacidadMaxima(2);
    await dbService.guardarConfiguracion('ocupacion_actual', '2');
    vi.stubGlobal('fetch', sinRed());

    render(<ControlAcceso />);

    expect(await screen.findByText(/CAMPING LLENO/)).toBeTruthy();
    expect(botonEscanear().disabled).toBe(true);
    expect(botonManual().disabled).toBe(true);
  });

  it('al volver la conexión descarga la capacidad y quita el aviso', async () => {
    const fetchFalso = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(bootstrapCon(60));
    vi.stubGlobal('fetch', fetchFalso);

    render(<ControlAcceso />);
    await screen.findByText('Capacidad no disponible');

    window.dispatchEvent(new Event('online'));

    expect(await screen.findByText('/ 60')).toBeTruthy();
    expect(screen.queryByText('Capacidad no disponible')).toBeNull();
  });

  it('ya no tiene el panel de pruebas QA ni simuladores de QR', async () => {
    vi.stubGlobal('fetch', sinRed());

    render(<ControlAcceso />);
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
  dat: '2026-11-09',
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
  vi.mocked(verifyQRToken).mockResolvedValue(payloadDe(reservaId));
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

    render(<ControlAcceso />);
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

    render(<ControlAcceso />);
    await escanear(RESERVA_CANCELADA);

    expect(await screen.findByText(/Reserva Cancelada/)).toBeTruthy();
    expect(await db.ingresos_pendientes.count()).toBe(0);
  });

  it('el QR de una reserva que no está en la lista se acepta y queda para sincronizar', async () => {
    await dbService.reemplazarBlacklist([RESERVA_CANCELADA]);
    vi.stubGlobal('fetch', sinRed());

    render(<ControlAcceso />);
    await escanear(RESERVA_VIGENTE);

    expect(await screen.findByText(/INGRESO CONFIRMADO/)).toBeTruthy();
    expect(screen.queryByText(/Reserva Cancelada/)).toBeNull();
    expect(await db.ingresos_pendientes.count()).toBe(1);
  });

  it('una reserva que salió de la lista del servidor vuelve a entrar', async () => {
    await dbService.reemplazarBlacklist([RESERVA_CANCELADA]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bootstrapConBlacklist([])));

    render(<ControlAcceso />);
    await waitFor(async () => expect(await dbService.verificarAccesoRevocado(RESERVA_CANCELADA)).toBe(false));
    await escanear(RESERVA_CANCELADA);

    expect(await screen.findByText(/INGRESO CONFIRMADO/)).toBeTruthy();
  });
});
