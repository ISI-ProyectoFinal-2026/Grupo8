// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './dialog';

// Como en el panel: el diálogo lo abre un botón cualquiera, no un DialogTrigger
function Pantalla() {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>
        Ver detalle
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogTitle>Detalle</DialogTitle>
          <DialogDescription>Datos de la reserva</DialogDescription>
          <button type="button" onClick={() => setAbierto(false)}>
            Cerrar
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('Diálogo (27.3)', () => {
  afterEach(cleanup);

  it('al cerrarse devuelve el foco al botón que lo abrió, aunque no sea un DialogTrigger', async () => {
    render(<Pantalla />);
    const abrir = screen.getByRole('button', { name: 'Ver detalle' });
    abrir.focus();
    fireEvent.click(abrir);

    const dialogo = await screen.findByRole('dialog', { name: 'Detalle' });
    await waitFor(() =>
      expect(dialogo.contains(document.activeElement)).toBe(true)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(abrir));
  });
});
