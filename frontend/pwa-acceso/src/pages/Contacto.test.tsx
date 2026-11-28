// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const VALIDO = {
  nombre: 'Ana Pérez',
  email: 'ana@correo.com',
  mensaje: 'Hola, quería consultar por las mascotas.',
};

function respuesta(status: number, cuerpo: unknown = {}): Response {
  return { ok: status < 400, status, json: async () => cuerpo } as unknown as Response;
}

// CAMPING se arma al importar el módulo: cada test carga la pantalla de nuevo con su .env
async function mostrar() {
  vi.resetModules();
  const { default: Contacto } = await import('./Contacto');
  return render(<Contacto />);
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta) as HTMLInputElement;
const botonEnviar = () => screen.getByRole('button', { name: /Enviar mensaje|Enviando/ }) as HTMLButtonElement;

function completar(datos = VALIDO) {
  fireEvent.change(campo('Nombre completo'), { target: { value: datos.nombre } });
  fireEvent.change(campo('Correo electrónico'), { target: { value: datos.email } });
  fireEvent.change(campo('Mensaje'), { target: { value: datos.mensaje } });
}

describe('Pantalla Contacto (31.5)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('datos de contacto', () => {
    it('salen de la configuración del camping y no del código', async () => {
      vi.stubEnv('VITE_CAMPING_EMAIL', 'reservas@elrefugio.com');
      vi.stubEnv('VITE_CAMPING_TELEFONO', '+54 9 11 5555-0000');
      vi.stubEnv('VITE_CAMPING_DIRECCION', 'Ruta 40 km 10, Mendoza');

      await mostrar();

      expect(screen.getByRole('link', { name: 'reservas@elrefugio.com' }).getAttribute('href')).toBe(
        'mailto:reservas@elrefugio.com'
      );
      expect(screen.getByRole('link', { name: '+54 9 11 5555-0000' }).getAttribute('href')).toBe(
        'tel:+549115555-0000'
      );
      expect(screen.getByText('Ruta 40 km 10, Mendoza')).toBeTruthy();
      expect(document.body.textContent).not.toContain('somosqamp@gmail.com');
    });

    it('lo que no está configurado no se muestra, y no queda ningún [COMPLETAR]', async () => {
      vi.stubEnv('VITE_CAMPING_EMAIL', '');
      vi.stubEnv('VITE_CAMPING_TELEFONO', '');
      vi.stubEnv('VITE_CAMPING_DIRECCION', '');

      await mostrar();

      expect(screen.queryByText('Teléfono / WhatsApp')).toBeNull();
      expect(screen.queryByText('Correo Electrónico')).toBeNull();
      expect(screen.queryByText('Ubicación')).toBeNull();
      expect(document.body.textContent).not.toContain('[COMPLETAR]');
    });
  });

  describe('validaciones', () => {
    it('con los campos vacíos marca los tres y no llama al backend', async () => {
      const fetchFalso = vi.fn();
      vi.stubGlobal('fetch', fetchFalso);
      await mostrar();

      fireEvent.click(botonEnviar());

      expect(screen.getAllByRole('alert')).toHaveLength(3);
      expect(campo('Nombre completo').getAttribute('aria-invalid')).toBe('true');
      expect(campo('Correo electrónico').getAttribute('aria-invalid')).toBe('true');
      expect(campo('Mensaje').getAttribute('aria-invalid')).toBe('true');
      expect(fetchFalso).not.toHaveBeenCalled();
    });

    it('rechaza un correo inválido', async () => {
      const fetchFalso = vi.fn();
      vi.stubGlobal('fetch', fetchFalso);
      await mostrar();
      completar({ ...VALIDO, email: 'no-es-un-correo' });

      fireEvent.click(botonEnviar());

      expect(screen.getByRole('alert').textContent).toMatch(/email válido/);
      expect(fetchFalso).not.toHaveBeenCalled();
    });

    it('rechaza un mensaje demasiado largo', async () => {
      const fetchFalso = vi.fn();
      vi.stubGlobal('fetch', fetchFalso);
      await mostrar();
      completar({ ...VALIDO, mensaje: 'a'.repeat(2001) });

      fireEvent.click(botonEnviar());

      expect(screen.getByRole('alert').textContent).toMatch(/no puede superar los 2000/);
      expect(fetchFalso).not.toHaveBeenCalled();
    });
  });

  describe('envío', () => {
    it('envía el mensaje al backend y muestra el éxito en pantalla, sin alert()', async () => {
      const fetchFalso = vi.fn().mockResolvedValue(respuesta(202, { mensaje: 'Recibimos tu mensaje.' }));
      vi.stubGlobal('fetch', fetchFalso);
      const alerta = vi.fn();
      vi.stubGlobal('alert', alerta);
      await mostrar();
      completar();

      fireEvent.click(botonEnviar());

      expect((await screen.findByRole('status')).textContent).toBe('Recibimos tu mensaje.');
      const [url, opciones] = fetchFalso.mock.calls[0];
      expect(new URL(String(url)).pathname).toBe('/contacto');
      expect(JSON.parse(opciones.body)).toEqual(VALIDO);
      expect(alerta).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Enviar mensaje' })).toBeNull();
    });

    it('después del éxito se puede escribir otro mensaje, con el formulario vacío', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(202, { mensaje: 'Listo' })));
      await mostrar();
      completar();
      fireEvent.click(botonEnviar());
      await screen.findByRole('status');

      fireEvent.click(screen.getByRole('button', { name: 'Enviar otro mensaje' }));

      expect(campo('Nombre completo').value).toBe('');
      expect(campo('Mensaje').value).toBe('');
    });

    it('mientras envía muestra que está enviando y bloquea el botón', async () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      await mostrar();
      completar();

      fireEvent.click(botonEnviar());

      expect(botonEnviar().textContent).toBe('Enviando…');
      expect(botonEnviar().disabled).toBe(true);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('no permite dos envíos simultáneos', async () => {
      const fetchFalso = vi.fn(() => new Promise(() => {}));
      vi.stubGlobal('fetch', fetchFalso);
      await mostrar();
      completar();
      const formulario = botonEnviar().closest('form')!;

      fireEvent.submit(formulario);
      fireEvent.submit(formulario);
      fireEvent.click(botonEnviar());

      expect(fetchFalso).toHaveBeenCalledTimes(1);
    });
  });

  describe('errores', () => {
    it('si el backend falla no muestra éxito, informa el error y conserva lo escrito', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(respuesta(502, { detail: 'No pudimos enviar tu mensaje. Probá de nuevo.' }))
      );
      await mostrar();
      completar();

      fireEvent.click(botonEnviar());

      expect((await screen.findByRole('alert')).textContent).toBe(
        'No pudimos enviar tu mensaje. Probá de nuevo.'
      );
      expect(screen.queryByRole('status')).toBeNull();
      expect(campo('Nombre completo').value).toBe(VALIDO.nombre);
      expect(campo('Correo electrónico').value).toBe(VALIDO.email);
      expect(campo('Mensaje').value).toBe(VALIDO.mensaje);
      expect(botonEnviar().disabled).toBe(false);
    });

    it('si superó el límite de envíos se lo informa', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          respuesta(429, { detail: 'Enviaste muchos mensajes en poco tiempo. Probá de nuevo en 5 minutos.' })
        )
      );
      await mostrar();
      completar();

      fireEvent.click(botonEnviar());

      expect((await screen.findByRole('alert')).textContent).toMatch(/Enviaste muchos mensajes/);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('sin conexión avisa y permite reintentar con los mismos datos', async () => {
      const fetchFalso = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('red'))
        .mockResolvedValueOnce(respuesta(202, { mensaje: 'Enviado.' }));
      vi.stubGlobal('fetch', fetchFalso);
      await mostrar();
      completar();

      fireEvent.click(botonEnviar());
      expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudo conectar/);

      fireEvent.click(botonEnviar());

      await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Enviado.'));
      expect(fetchFalso).toHaveBeenCalledTimes(2);
    });
  });
});
