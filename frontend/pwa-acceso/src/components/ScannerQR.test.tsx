// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScannerQR } from './ScannerQR';

// Sin cámara: así el componente no intenta abrir ningún dispositivo
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    static getCameras = vi.fn().mockResolvedValue([]);
  },
}));

describe('ScannerQR — ingreso manual del token (Issue 16.5)', () => {
  afterEach(() => cleanup());

  it('conserva el campo y el botón para ingresar un token a mano', () => {
    render(<ScannerQR onScanSuccess={vi.fn()} />);

    expect(screen.getByPlaceholderText('Pega el JWT aquí...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Validar' })).toBeTruthy();
  });

  it('envía el token sin espacios y limpia el campo', () => {
    const alEscanear = vi.fn();
    render(<ScannerQR onScanSuccess={alEscanear} />);
    const campo = screen.getByPlaceholderText('Pega el JWT aquí...') as HTMLInputElement;

    fireEvent.change(campo, { target: { value: '  aaa.bbb.ccc  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));

    expect(alEscanear).toHaveBeenCalledTimes(1);
    expect(alEscanear).toHaveBeenCalledWith('aaa.bbb.ccc');
    expect(campo.value).toBe('');
  });

  it('no envía nada si el campo está vacío', () => {
    const alEscanear = vi.fn();
    render(<ScannerQR onScanSuccess={alEscanear} />);

    fireEvent.change(screen.getByPlaceholderText('Pega el JWT aquí...'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));

    expect(alEscanear).not.toHaveBeenCalled();
  });

  it('ya no muestra el modo de pruebas ni botones de simulación', () => {
    render(<ScannerQR onScanSuccess={vi.fn()} />);

    expect(screen.queryByText(/Modo Test/)).toBeNull();
    expect(screen.queryByText(/Simular/)).toBeNull();
  });
});