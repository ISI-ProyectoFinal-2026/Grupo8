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
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { dbService } from '@/services/dbService';
import RegistroManual from './RegistroManual';

function simularConexion(enLinea: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => enLinea,
  });
}

function mostrar() {
  return render(
    <MemoryRouter initialEntries={['/acceso/manual']}>
      <Routes>
        <Route path="/acceso/manual" element={<RegistroManual />} />
        <Route path="/acceso" element={<p>Pantalla del escáner</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function completar({
  dni = '30111222',
  nombre = 'Elena Efectivo',
  acompanantes = '1',
  monto = '3500',
} = {}) {
  fireEvent.change(screen.getByLabelText('DNI / Pasaporte'), {
    target: { value: dni },
  });
  fireEvent.change(screen.getByLabelText('Nombre completo'), {
    target: { value: nombre },
  });
  fireEvent.change(screen.getByLabelText('Acompañantes'), {
    target: { value: acompanantes },
  });
  fireEvent.change(screen.getByLabelText(/Monto cobrado en efectivo/), {
    target: { value: monto },
  });
}

describe('Registro manual en su propia pantalla (26.4)', () => {
  beforeEach(async () => {
    simularConexion(false);
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.configuracion.clear();
  });

  afterEach(async () => {
    cleanup();
    simularConexion(true);
    await db.ingresos_pendientes.clear();
    await db.historial.clear();
    await db.configuracion.clear();
  });

  it('muestra el formulario con su título', () => {
    mostrar();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Registro manual' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Guardar Ingreso' })
    ).toBeTruthy();
  });

  it('al guardar muestra la confirmación de la pantalla 4 con el ID local y lo deja en la cola', async () => {
    mostrar();
    completar();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar Ingreso' }));

    const titulo = await screen.findByRole('heading', {
      level: 1,
      name: 'Ingreso registrado',
    });
    // El foco pasa a la confirmación para que el lector la anuncie
    await waitFor(() => expect(document.activeElement).toBe(titulo));
    expect(
      screen.getByText('Se sincronizará cuando regrese Internet.')
    ).toBeTruthy();

    const [pendiente] = await db.ingresos_pendientes.toArray();
    expect(screen.getByText('ID local').nextElementSibling?.textContent).toBe(
      pendiente.jti
    );
    expect(pendiente.qr_payload).toMatchObject({
      dni: '30111222',
      cantidad_personas: 2,
      monto_cobrado: 3500,
    });
    expect(screen.getByText('Personas').nextElementSibling?.textContent).toBe(
      '2'
    );
    expect(
      screen.getByText('Monto cobrado').nextElementSibling?.textContent
    ).toBe('$3500.00');
  });

  it('"Aceptar" vuelve al escáner', async () => {
    mostrar();
    completar();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Ingreso' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar' }));

    expect(screen.getByText('Pantalla del escáner')).toBeTruthy();
  });

  it('con conexión, la confirmación no dice que falta Internet', async () => {
    simularConexion(true);
    mostrar();
    completar();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Ingreso' }));

    expect(
      await screen.findByText(
        'Se envía al servidor en la próxima sincronización.'
      )
    ).toBeTruthy();
  });

  it('"Cancelar" vuelve al escáner sin guardar nada', async () => {
    mostrar();
    completar();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByText('Pantalla del escáner')).toBeTruthy();
    expect(await db.ingresos_pendientes.count()).toBe(0);
  });

  it('sin DNI o sin monto avisa en la pantalla y no guarda', async () => {
    mostrar();
    completar({ dni: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Ingreso' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Completá el DNI y el nombre/
    );

    completar({ monto: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Ingreso' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Ingresá el monto cobrado/
    );

    expect(await db.ingresos_pendientes.count()).toBe(0);
  });

  it('con el camping lleno no deja guardar', async () => {
    await dbService.guardarCapacidadMaxima(2);
    await dbService.guardarConfiguracion('ocupacion_actual', '2');
    mostrar();

    expect(
      await screen.findByText(
        /CAMPING LLENO: no se pueden registrar más ingresos/
      )
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: 'Guardar Ingreso',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('si el grupo no entra en el cupo, muestra el motivo y sigue en el formulario', async () => {
    await dbService.guardarCapacidadMaxima(3);
    await dbService.guardarConfiguracion('ocupacion_actual', '2');
    mostrar();
    completar({ acompanantes: '1' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar Ingreso' }));
    });

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /CAPACIDAD_EXCEDIDA/
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Registro manual' })
    ).toBeTruthy();
  });
});
