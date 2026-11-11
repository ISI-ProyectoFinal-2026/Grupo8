// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TipoReserva } from '@/lib/tiposReserva';
import Home from './Home';

// El Select de Radix no se puede manejar bien en jsdom: se reemplaza por un <select> nativo
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (valor: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="Tipo de reserva"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">Seleccioná una opción...</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

// Precios y nombres que no están en ningún lado del frontend: si aparecen, vinieron del backend
const DOMO: TipoReserva = {
  id: 't-domo',
  nombre: 'Domo geodésico',
  precio: 31700,
  forma_cobro: 'POR_UNIDAD',
  max_personas: 3,
  cantidad_unidades: 2,
};
const PARCELA: TipoReserva = {
  id: 't-parcela',
  nombre: 'Parcela premium',
  precio: 6300,
  forma_cobro: 'POR_PERSONA',
  max_personas: 8,
  cantidad_unidades: null,
};

const FECHA = '2030-01-10';

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status < 400,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

function simularTipos(...respuestas: Array<TipoReserva[] | 'error'>) {
  const fetchFalso = vi.fn();
  for (const r of respuestas) {
    fetchFalso.mockResolvedValueOnce(
      r === 'error' ? respuesta(500, {}) : respuesta(200, r)
    );
  }
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

// Muestra lo que recibe la siguiente pantalla
function DestinoDisponibilidad() {
  const location = useLocation();
  return <pre data-testid="estado">{JSON.stringify(location.state)}</pre>;
}

function mostrarHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/disponibilidad" element={<DestinoDisponibilidad />} />
      </Routes>
    </MemoryRouter>
  );
}

const selector = () =>
  screen.getByLabelText('Tipo de reserva') as HTMLSelectElement;

function completar({
  tipo,
  personas,
  noches,
}: {
  tipo: TipoReserva;
  personas: string;
  noches: string;
}) {
  fireEvent.change(document.getElementById('fecha')!, {
    target: { value: FECHA },
  });
  fireEvent.change(document.getElementById('personas')!, {
    target: { value: personas },
  });
  fireEvent.change(selector(), { target: { value: tipo.id } });
  fireEvent.change(document.getElementById('noches')!, {
    target: { value: noches },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

function estadoEnviado() {
  return JSON.parse(screen.getByTestId('estado').textContent ?? 'null');
}

describe('Home: tipos de reserva del backend (Issue 19.4)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('muestra un aviso mientras carga y no deja continuar', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    mostrarHome();

    expect(screen.getByText('Cargando tipos de reserva…')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('lista los tipos activos con el nombre y el precio que manda el backend', async () => {
    const fetchFalso = simularTipos([PARCELA, DOMO]);

    mostrarHome();

    await waitFor(() => expect(selector().options).toHaveLength(3));
    const opciones = Array.from(selector().options).map((o) => o.textContent);
    expect(opciones).toContain('Parcela premium — $6.300 por persona');
    expect(opciones).toContain('Domo geodésico — $31.700 por noche');
    expect(String(fetchFalso.mock.calls[0][0])).toMatch(
      /\/api\/v1\/tipos-reserva$/
    );
  });

  it('sin tipos activos avisa y no deja continuar', async () => {
    simularTipos([]);

    mostrarHome();

    expect(
      await screen.findByText(
        'No hay tipos de reserva disponibles por el momento.'
      )
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Continuar' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('si falla la carga muestra el error y permite reintentar', async () => {
    const fetchFalso = simularTipos('error', [PARCELA]);

    mostrarHome();

    expect(
      await screen.findByText(/No pudimos cargar los tipos de reserva/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(selector().options).toHaveLength(2));
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('por persona deja pasar el día (0 noches) y envía el tipo completo', async () => {
    simularTipos([PARCELA]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: PARCELA, personas: '3', noches: '0' });

    const estado = estadoEnviado();
    expect(estado).toEqual({
      fecha: FECHA,
      fechaEgreso: FECHA,
      personas: '3',
      tipo: PARCELA,
    });
  });

  it('por unidad calcula el egreso con las noches', async () => {
    simularTipos([DOMO]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: DOMO, personas: '2', noches: '3' });

    expect(estadoEnviado()).toMatchObject({
      fechaEgreso: '2030-01-13',
      tipo: DOMO,
    });
  });

  it('por unidad pide al menos una noche', async () => {
    simularTipos([DOMO]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: DOMO, personas: '2', noches: '0' });

    expect(
      screen.getByText('Domo geodésico se reserva por al menos 1 noche.')
    ).toBeTruthy();
    expect(screen.queryByTestId('estado')).toBeNull();
  });

  it('el máximo de personas sale del tipo elegido', async () => {
    simularTipos([DOMO]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: DOMO, personas: '4', noches: '1' });

    expect(
      screen.getByText('Domo geodésico admite como máximo 3 personas.')
    ).toBeTruthy();
    expect(screen.getByText('Cantidad de personas (máx. 3)')).toBeTruthy();
  });

  it('sin elegir tipo no continúa', async () => {
    simularTipos([PARCELA]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.getByText('Seleccioná un tipo de reserva.')).toBeTruthy();
  });
});
