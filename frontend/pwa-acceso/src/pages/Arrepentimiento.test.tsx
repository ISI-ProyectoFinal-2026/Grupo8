// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Arrepentimiento from './Arrepentimiento';

const MENSAJE =
  'Si hay reservas con ese email, te enviamos un correo con un enlace para cada una.';

function respuesta(status: number, cuerpo: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo } as unknown as Response;
}

function mostrar() {
  render(
    <MemoryRouter>
      <Arrepentimiento />
    </MemoryRouter>
  );
}

function escribirYEnviar(email: string) {
  fireEvent.change(screen.getByLabelText('Email de la reserva'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
}

describe('Botón de arrepentimiento (25.3)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('solo pide el email, sin iniciar sesión', () => {
    mostrar();

    expect(screen.getByRole('heading', { name: 'Botón de arrepentimiento', level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('con un email inválido marca el campo y no llama al backend', () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    mostrar();

    escribirYEnviar('no-es-un-email');

    const campo = screen.getByLabelText('Email de la reserva');
    expect(screen.getByRole('alert').textContent).toMatch(/Ingresá un email válido/);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('mientras envía muestra que está enviando', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    mostrar();

    escribirYEnviar('ana@correo.com');

    const boton = await screen.findByRole('button', { name: 'Enviando…' });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
  });

  it('después de enviar muestra el mensaje, existan o no reservas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(202, { mensaje: MENSAJE })));
    mostrar();

    escribirYEnviar('ana@correo.com');

    expect((await screen.findByRole('status')).textContent).toBe(MENSAJE);
    expect(screen.queryByRole('button', { name: 'Enviar enlace' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Volver al inicio' }).getAttribute('href')).toBe('/');
  });

  it('"Usar otro email" vuelve al formulario vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(202, { mensaje: MENSAJE })));
    mostrar();
    escribirYEnviar('ana@correo.com');

    fireEvent.click(await screen.findByRole('button', { name: 'Usar otro email' }));

    expect((screen.getByLabelText('Email de la reserva') as HTMLInputElement).value).toBe('');
  });

  it('si falla el envío muestra el error y deja reintentar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(500)));
    mostrar();

    escribirYEnviar('ana@correo.com');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'No pudimos enviar el correo. Intentá nuevamente.'
    );
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });
});
