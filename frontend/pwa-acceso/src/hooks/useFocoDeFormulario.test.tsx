// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enfocarPrimerCampo,
  useEnfocarAviso,
  useVolverAlAbridor,
} from './useFocoDeFormulario';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('enfocarPrimerCampo', () => {
  it('lleva el foco al primer campo habilitado del formulario', () => {
    render(
      <form ref={enfocarPrimerCampo}>
        <input aria-label="Código" disabled />
        <input aria-label="Nombre" />
      </form>
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Nombre'));
  });
});

// Pantalla mínima: "Nuevo" se oculta mientras el formulario está abierto, como en Socios
function PantallaConFormulario() {
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState('');
  const { recordar, volver } = useVolverAlAbridor();
  const refNuevo = useRef<HTMLButtonElement>(null);
  const refAviso = useEnfocarAviso<HTMLParagraphElement>(aviso);

  return (
    <>
      {aviso && (
        <p ref={refAviso} role="status" tabIndex={-1}>
          {aviso}
        </p>
      )}
      {!abierto && (
        <button
          ref={refNuevo}
          type="button"
          onClick={() => {
            recordar();
            setAbierto(true);
          }}
        >
          Nuevo
        </button>
      )}
      {abierto && (
        <form ref={enfocarPrimerCampo}>
          <input aria-label="Nombre" />
          <button
            type="button"
            onClick={() => {
              setAbierto(false);
              volver(refNuevo);
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              setAbierto(false);
              setAviso('Guardado.');
            }}
          >
            Guardar
          </button>
        </form>
      )}
    </>
  );
}

describe('formularios dentro de la pantalla', () => {
  it('al cancelar vuelve al botón que lo abrió, aunque se haya vuelto a dibujar', () => {
    vi.useFakeTimers();
    render(<PantallaConFormulario />);
    const nuevo = screen.getByRole('button', { name: 'Nuevo' });
    nuevo.focus();
    fireEvent.click(nuevo);
    expect(document.activeElement).toBe(screen.getByLabelText('Nombre'));

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    vi.runAllTimers();

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Nuevo' })
    );
  });

  it('al guardar, el foco va al aviso porque el formulario ya no está', () => {
    render(<PantallaConFormulario />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    guardar.focus();
    fireEvent.click(guardar);

    expect(document.activeElement).toBe(screen.getByRole('status'));
  });

  it('no mueve el foco al aviso si el botón usado sigue en pantalla', () => {
    function Activar() {
      const [aviso, setAviso] = useState('');
      const ref = useEnfocarAviso<HTMLParagraphElement>(aviso);
      return (
        <>
          {aviso && (
            <p ref={ref} role="status" tabIndex={-1}>
              {aviso}
            </p>
          )}
          <button
            type="button"
            onClick={() => setAviso('Descuento desactivado.')}
          >
            Desactivar
          </button>
        </>
      );
    }
    render(<Activar />);
    const boton = screen.getByRole('button', { name: 'Desactivar' });
    boton.focus();
    fireEvent.click(boton);

    expect(document.activeElement).toBe(boton);
  });
});
