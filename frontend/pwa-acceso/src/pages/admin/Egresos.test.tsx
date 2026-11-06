// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Egresos from './Egresos';
import {
  obtenerOcupacion,
  OcupacionApiError,
  registrarEgreso,
  type Egreso,
  type Ocupacion,
} from '@/services/ocupacionService';

// Se reemplazan solo las llamadas a la red; la clase de error y mensajeDeError son los reales
vi.mock('@/services/ocupacionService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/ocupacionService')>();
  return { ...original, obtenerOcupacion: vi.fn(), registrarEgreso: vi.fn() };
});
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'token-de-prueba' }),
  AUTH_EXPIRED_EVENT: 'qamp:auth-expired',
}));

const ocupacion = (actual: number): Ocupacion => ({
  ocupacion_actual: actual,
  capacidad_maxima: 50,
  buffer_offline: 5,
});

const egreso = (cantidad: number, dentro: number): Egreso => ({
  id: 'egreso-1',
  cantidad_personas: cantidad,
  fecha_hora_egreso: '2026-11-03T18:30:00+00:00',
  registrado_por_id: 'admin-1',
  personas_dentro: dentro,
});

const campo = () => screen.getByLabelText('Personas que salen');
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Registrar egreso' }));

async function renderizarCon(actual: number) {
  vi.mocked(obtenerOcupacion).mockResolvedValueOnce(ocupacion(actual));
  render(<Egresos />);
  await screen.findByText(`${Math.round((actual * 100) / 50)} %`);
}

describe('Pantalla de egresos', () => {
  beforeEach(() => {
    vi.mocked(obtenerOcupacion).mockReset();
    vi.mocked(registrarEgreso).mockReset();
  });
  afterEach(() => cleanup());

  it('muestra el monitor y el formulario', async () => {
    await renderizarCon(10);

    expect(screen.getByRole('heading', { level: 1, name: 'Egresos' })).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Ocupación del camping' })).toBeTruthy();
    expect(campo()).toBeTruthy();
  });

  it('registra el egreso y actualiza el monitor', async () => {
    await renderizarCon(10);
    vi.mocked(registrarEgreso).mockResolvedValue(egreso(2, 8));
    vi.mocked(obtenerOcupacion).mockResolvedValueOnce(ocupacion(8));

    fireEvent.change(campo(), { target: { value: '2' } });
    enviar();

    expect(await screen.findByText('Se registró el egreso de 2 personas.')).toBeTruthy();
    expect(registrarEgreso).toHaveBeenCalledWith('token-de-prueba', 2);
    expect(await screen.findByText('16 %')).toBeTruthy();
    expect(obtenerOcupacion).toHaveBeenCalledTimes(2);
    expect((campo() as HTMLInputElement).value).toBe('');
  });

  it.each([
    ['', 'Ingresá cuántas personas salen.'],
    ['0', 'Tiene que salir al menos 1 persona.'],
    ['11', 'Solo hay 10 personas dentro del camping.'],
  ])('con "%s" muestra un error y no envía nada', async (valor, mensaje) => {
    await renderizarCon(10);

    fireEvent.change(campo(), { target: { value: valor } });
    enviar();

    expect(await screen.findByText(mensaje)).toBeTruthy();
    expect(registrarEgreso).not.toHaveBeenCalled();
  });

  it('muestra el error del servidor y vuelve a consultar la ocupación', async () => {
    await renderizarCon(10);
    vi.mocked(registrarEgreso).mockRejectedValue(
      new OcupacionApiError(409, 'No pueden egresar 3 personas: según los ingresos sincronizados hay 2 dentro.')
    );
    vi.mocked(obtenerOcupacion).mockResolvedValueOnce(ocupacion(2));

    fireEvent.change(campo(), { target: { value: '3' } });
    enviar();

    expect(await screen.findByText(/hay 2 dentro/)).toBeTruthy();
    await waitFor(() => expect(obtenerOcupacion).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('4 %')).toBeTruthy();
  });

  it('avisa si no hay conexión', async () => {
    await renderizarCon(10);
    vi.mocked(registrarEgreso).mockRejectedValue(new TypeError('Failed to fetch'));

    fireEvent.change(campo(), { target: { value: '1' } });
    enviar();

    expect(await screen.findByText('No se pudo conectar con el servidor.')).toBeTruthy();
    expect(screen.queryByText(/Se registró el egreso/)).toBeNull();
  });
});