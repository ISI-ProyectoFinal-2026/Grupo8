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
import { formatearFecha, sumarDias } from '@/lib/fechas';
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

const CUPO = 80;

// Cómo responde el backend de mentira a GET /disponibilidad
interface Disponibilidad {
  /** Personas ocupadas de cada día a partir de `desde` (lo que no se indica queda libre). */
  ocupados?: (desde: string) => number[];
  /** Personas ocupadas en toda la estadía, si la consulta trae `egreso`. */
  ocupadosEstadia?: number;
  /** Fechas `desde` para las que la consulta falla. */
  fallan?: string[];
}

function cuerpoDisponibilidad(url: URL, config: Disponibilidad) {
  const desde = url.searchParams.get('desde')!;
  const egreso = url.searchParams.get('egreso');
  const lugares = (ocupados: number) => {
    const disponibles = Math.max(CUPO - ocupados, 0);
    return { ocupados, disponibles, completo: disponibles === 0 };
  };
  const ocupados = config.ocupados?.(desde) ?? [];
  return {
    cupo_maximo: CUPO,
    dias: Array.from({ length: 7 }, (_, i) => ({
      fecha: sumarDias(desde, i),
      ...lugares(ocupados[i] ?? 0),
    })),
    estadia: egreso
      ? { ingreso: desde, egreso, ...lugares(config.ocupadosEstadia ?? 0) }
      : null,
  };
}

// Los tipos salen de la cola (uno por llamada); GET /disponibilidad se contesta según la configuración
function simularTipos(
  respuestas: Array<TipoReserva[] | 'error'>,
  disponibilidad: Disponibilidad = {}
) {
  const cola = [...respuestas];
  const fetchFalso = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada));
    if (url.pathname === '/disponibilidad') {
      if (disponibilidad.fallan?.includes(url.searchParams.get('desde')!))
        return respuesta(500, {});
      return respuesta(200, cuerpoDisponibilidad(url, disponibilidad));
    }
    const siguiente = cola.shift();
    return siguiente === undefined || siguiente === 'error'
      ? respuesta(500, {})
      : respuesta(200, siguiente);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

const consultasDeDisponibilidad = (fetchFalso: ReturnType<typeof simularTipos>) =>
  fetchFalso.mock.calls
    .map(([entrada]) => new URL(String(entrada)))
    .filter((url) => url.pathname === '/disponibilidad');

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

function llenar({
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
}

function completar(datos: Parameters<typeof llenar>[0]) {
  llenar(datos);
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
    const fetchFalso = simularTipos([[PARCELA, DOMO]]);

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
    simularTipos([[]]);

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
    const fetchFalso = simularTipos(['error', [PARCELA]]);

    mostrarHome();

    expect(
      await screen.findByText(/No pudimos cargar los tipos de reserva/)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(selector().options).toHaveLength(2));
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it('por persona deja pasar el día (0 noches) y envía el tipo completo', async () => {
    simularTipos([[PARCELA]]);
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
    simularTipos([[DOMO]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: DOMO, personas: '2', noches: '3' });

    expect(estadoEnviado()).toMatchObject({
      fechaEgreso: '2030-01-13',
      tipo: DOMO,
    });
  });

  it('por unidad pide al menos una noche', async () => {
    simularTipos([[DOMO]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: DOMO, personas: '2', noches: '0' });

    expect(
      screen.getByText('Domo geodésico se reserva por al menos 1 noche.')
    ).toBeTruthy();
    expect(screen.queryByTestId('estado')).toBeNull();
  });

  it('el máximo de personas sale del tipo elegido', async () => {
    simularTipos([[DOMO]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    completar({ tipo: DOMO, personas: '4', noches: '1' });

    expect(
      screen.getByText('Domo geodésico admite como máximo 3 personas.')
    ).toBeTruthy();
    expect(screen.getByText('Cantidad de personas (máx. 3)')).toBeTruthy();
  });

  it('sin elegir tipo no continúa', async () => {
    simularTipos([[PARCELA]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.getByText('Seleccioná un tipo de reserva.')).toBeTruthy();
  });
});

describe('Home: cupo de los días posteriores (Issue 31.4)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const elegirFecha = (fecha: string) =>
    fireEvent.change(document.getElementById('fecha')!, {
      target: { value: fecha },
    });

  // Cada día de la lista es un botón: su nombre trae la fecha y los lugares
  const dia = (fecha: string) =>
    screen.getByRole('button', {
      name: new RegExp(formatearFecha(fecha)),
    }) as HTMLButtonElement;

  it('no consulta ni muestra nada hasta que hay una fecha', async () => {
    const fetchFalso = simularTipos([[PARCELA]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    expect(screen.queryByText('Lugares disponibles')).toBeNull();
    expect(consultasDeDisponibilidad(fetchFalso)).toHaveLength(0);
  });

  it('muestra día libre, parcial y completo con los números exactos', async () => {
    simularTipos([[PARCELA]], { ocupados: () => [0, 15, 80] });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    elegirFecha(FECHA);

    expect(await screen.findByText('Lugares disponibles')).toBeTruthy();
    await waitFor(() => expect(dia(FECHA)).toBeTruthy());
    expect(dia(FECHA).textContent).toContain('80 lugares libres de 80');
    expect(dia(FECHA).textContent).toContain('0 ocupados');
    expect(dia('2030-01-11').textContent).toContain('65 lugares libres de 80');
    expect(dia('2030-01-11').textContent).toContain('15 ocupados');
    expect(dia('2030-01-12').textContent).toContain('Completo');
  });

  it('muestra los días siguientes al elegido', async () => {
    simularTipos([[PARCELA]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    elegirFecha(FECHA);

    await waitFor(() => expect(dia(FECHA)).toBeTruthy());
    for (const i of [1, 2, 3, 4, 5, 6]) {
      expect(dia(sumarDias(FECHA, i))).toBeTruthy();
    }
  });

  it('un día completo no se puede elegir desde la lista', async () => {
    simularTipos([[PARCELA]], { ocupados: () => [0, 80] });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    elegirFecha(FECHA);
    await waitFor(() => expect(dia('2030-01-11')).toBeTruthy());

    expect(dia('2030-01-11').disabled).toBe(true);
    fireEvent.click(dia('2030-01-11'));
    expect((document.getElementById('fecha') as HTMLInputElement).value).toBe(
      FECHA
    );
    expect(dia(FECHA).disabled).toBe(false);
  });

  it('elegir un día libre de la lista completa la fecha del formulario', async () => {
    simularTipos([[PARCELA]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    elegirFecha(FECHA);
    await waitFor(() => expect(dia('2030-01-12')).toBeTruthy());

    fireEvent.click(dia('2030-01-12'));

    expect((document.getElementById('fecha') as HTMLInputElement).value).toBe(
      '2030-01-12'
    );
  });

  it('no deja continuar si el día elegido está completo', async () => {
    simularTipos([[PARCELA]], { ocupados: () => [80, 0] });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    llenar({ tipo: PARCELA, personas: '2', noches: '1' });
    await waitFor(() =>
      expect(dia(FECHA).textContent).toContain('Completo')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(
      screen.getByText('Ese día está completo. Elegí otro día de la lista.')
    ).toBeTruthy();
    expect(screen.queryByTestId('estado')).toBeNull();
  });

  it('con un día libre sigue adelante', async () => {
    simularTipos([[PARCELA]], { ocupados: () => [10, 80] });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    llenar({ tipo: PARCELA, personas: '2', noches: '1' });
    await waitFor(() =>
      expect(dia(FECHA).textContent).toContain('70 lugares libres')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(estadoEnviado()).toMatchObject({ fecha: FECHA, personas: '2' });
  });

  it('cualquier fecha se consulta de nuevo, no solo las posteriores', async () => {
    const fetchFalso = simularTipos([[PARCELA]], {
      ocupados: (desde) => (desde === '2030-03-01' ? [25] : [0]),
    });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    elegirFecha(FECHA);
    await waitFor(() => expect(dia(FECHA)).toBeTruthy());

    elegirFecha('2030-03-01');

    await waitFor(() =>
      expect(dia('2030-03-01').textContent).toContain('55 lugares libres de 80')
    );
    expect(
      consultasDeDisponibilidad(fetchFalso).map((u) =>
        u.searchParams.get('desde')
      )
    ).toEqual([FECHA, '2030-03-01']);
  });

  it('pide también la estadía cuando hay noches válidas', async () => {
    const fetchFalso = simularTipos([[PARCELA]]);
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));

    llenar({ tipo: PARCELA, personas: '2', noches: '3' });

    await waitFor(() => {
      const consultas = consultasDeDisponibilidad(fetchFalso);
      const ultima = consultas[consultas.length - 1];
      expect(ultima.searchParams.get('egreso')).toBe('2030-01-13');
    });
  });

  it('avisa y no deja continuar si la estadía no tiene lugar para todas las personas', async () => {
    simularTipos([[PARCELA]], { ocupadosEstadia: 78 });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    llenar({ tipo: PARCELA, personas: '5', noches: '2' });
    expect(await screen.findByText(/quedan/)).toBeTruthy();
    expect(screen.getByText(/Con 5 personas no alcanza/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(
      screen.getByText(
        'Para esa estadía quedan 2 lugares. Elegí otras fechas o menos personas.'
      )
    ).toBeTruthy();
    expect(screen.queryByTestId('estado')).toBeNull();
  });

  it('si falla la consulta no deja datos viejos en pantalla y permite reintentar', async () => {
    const fetchFalso = simularTipos([[PARCELA]], {
      ocupados: () => [0, 80],
      fallan: ['2030-02-01'],
    });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    elegirFecha(FECHA);
    await waitFor(() =>
      expect(dia('2030-01-11').textContent).toContain('Completo')
    );

    elegirFecha('2030-02-01');

    expect(
      await screen.findByText(/No pudimos consultar la disponibilidad/)
    ).toBeTruthy();
    expect(screen.queryByText(/Completo/)).toBeNull();
    expect(screen.queryByText(/lugares libres/)).toBeNull();

    const antes = consultasDeDisponibilidad(fetchFalso).length;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(consultasDeDisponibilidad(fetchFalso).length).toBe(antes + 1)
    );
  });

  it('si la consulta falló no bloquea: decide el backend al reservar', async () => {
    simularTipos([[PARCELA]], { fallan: [FECHA] });
    mostrarHome();
    await waitFor(() => expect(selector().options).toHaveLength(2));
    llenar({ tipo: PARCELA, personas: '2', noches: '1' });
    await screen.findByText(/No pudimos consultar la disponibilidad/);

    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(estadoEnviado()).toMatchObject({ fecha: FECHA });
  });
});
