import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeCampo } from '@/components/ErrorDeCampo';
import {
  atributosDeError,
  enfocarPrimerError,
  idDelError,
} from './errorDeCampo';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('atributosDeError', () => {
  it('sin error no marca el campo', () => {
    expect(atributosDeError('fecha', '')).toEqual({
      'aria-invalid': undefined,
      'aria-describedby': undefined,
    });
  });

  it('conserva el texto de ayuda y suma el error después', () => {
    expect(atributosDeError('dias', '', 'dias-ayuda')['aria-describedby']).toBe(
      'dias-ayuda'
    );
    expect(
      atributosDeError('dias', 'Mal', 'dias-ayuda')['aria-describedby']
    ).toBe('dias-ayuda dias-error');
  });

  it('acepta true cuando el mensaje lo muestra otro componente', () => {
    expect(atributosDeError('dni-0', true)['aria-describedby']).toBe(
      'dni-0-error'
    );
  });

  it('con error marca el campo y apunta al mensaje', () => {
    expect(atributosDeError('fecha', 'La fecha es obligatoria.')).toEqual({
      'aria-invalid': true,
      'aria-describedby': 'fecha-error',
    });
  });
});

describe('ErrorDeCampo', () => {
  it('el lector de pantalla lee el error como descripción del campo', () => {
    render(
      <>
        <label htmlFor="edad">Edad</label>
        <input
          id="edad"
          {...atributosDeError('edad', 'La edad es obligatoria.')}
        />
        <ErrorDeCampo idCampo="edad" mensaje="La edad es obligatoria." />
      </>
    );

    const campo = screen.getByLabelText('Edad');
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe(idDelError('edad'));
    expect(screen.getByRole('alert').textContent).toBe(
      'La edad es obligatoria.'
    );
  });

  it('sin mensaje no dibuja nada', () => {
    const { container } = render(
      <ErrorDeCampo idCampo="edad" mensaje={null} />
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('enfocarPrimerError', () => {
  it('pone el foco en el primer campo con error', () => {
    vi.useFakeTimers();
    render(
      <>
        <input aria-label="Nombre" />
        <input aria-label="Edad" aria-invalid="true" />
        <input aria-label="DNI" aria-invalid="true" />
      </>
    );

    enfocarPrimerError();
    vi.runAllTimers();

    expect(document.activeElement).toBe(screen.getByLabelText('Edad'));
  });
});
