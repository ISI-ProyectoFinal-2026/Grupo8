// @vitest-environment jsdom

import 'fake-indexeddb/auto';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { dbService } from '../services/dbService';
import ControlAcceso from './ControlAcceso';

// La sincronización de fondo y la cámara no son lo que se prueba acá
vi.mock('../services/syncService', () => ({ syncService: { iniciarBackgroundSync: vi.fn() } }));
vi.mock('../components/ScannerQR', () => ({ ScannerQR: () => null }));

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