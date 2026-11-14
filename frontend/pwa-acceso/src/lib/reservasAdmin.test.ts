import { describe, expect, it } from 'vitest';
import {
  construirConsulta,
  etiquetaEstadoPago,
  filtrosVacios,
  formatearFechaHora,
  hayFiltros,
  numeroReserva,
  rangoInvalido,
  TAMANIO_PAGINA,
  textoPaginacion,
  totalPaginas,
} from './reservasAdmin';

describe('construirConsulta', () => {
  it('sin filtros pide solo la página', () => {
    expect(construirConsulta(filtrosVacios, 0)).toBe(`?skip=0&limit=${TAMANIO_PAGINA}`);
  });

  it('manda cada filtro con el nombre que espera el backend', () => {
    const consulta = new URLSearchParams(
      construirConsulta(
        {
          busqueda: '  Ana Pérez ',
          estadoReserva: 'Alerta de clonación',
          tipoCliente: 'socio',
          fechaDesde: '2026-12-01',
          fechaHasta: '2026-12-31',
        },
        2
      ).slice(1)
    );

    expect(consulta.get('skip')).toBe(String(2 * TAMANIO_PAGINA));
    expect(consulta.get('busqueda')).toBe('Ana Pérez');
    expect(consulta.get('estado_reserva')).toBe('Alerta de clonación');
    expect(consulta.get('tipo_cliente')).toBe('socio');
    expect(consulta.get('fecha_desde')).toBe('2026-12-01');
    expect(consulta.get('fecha_hasta')).toBe('2026-12-31');
  });

  it('una búsqueda con solo espacios no se manda', () => {
    expect(construirConsulta({ ...filtrosVacios, busqueda: '   ' }, 0)).not.toContain('busqueda');
  });
});

describe('filtros', () => {
  it('detecta si hay algún filtro cargado', () => {
    expect(hayFiltros(filtrosVacios)).toBe(false);
    expect(hayFiltros({ ...filtrosVacios, tipoCliente: 'visitante' })).toBe(true);
  });

  it('el rango es inválido solo si "hasta" es anterior a "desde"', () => {
    expect(rangoInvalido({ ...filtrosVacios, fechaDesde: '2026-12-10', fechaHasta: '2026-12-01' })).toBe(true);
    expect(rangoInvalido({ ...filtrosVacios, fechaDesde: '2026-12-10', fechaHasta: '2026-12-10' })).toBe(false);
    expect(rangoInvalido({ ...filtrosVacios, fechaHasta: '2026-12-01' })).toBe(false);
  });
});

describe('textos de la tabla', () => {
  it('el número de reserva es el comienzo del id', () => {
    expect(numeroReserva('a1b2c3d4-0000-4000-8000-000000000000')).toBe('#a1b2c3d4');
  });

  it('describe la página que se está viendo', () => {
    expect(textoPaginacion(0, 20, 45)).toBe('Mostrando 1–20 de 45');
    expect(textoPaginacion(2, 5, 45)).toBe('Mostrando 41–45 de 45');
    expect(textoPaginacion(0, 0, 0)).toBe('Sin resultados');
  });

  it('calcula la cantidad de páginas', () => {
    expect(totalPaginas(0)).toBe(1);
    expect(totalPaginas(TAMANIO_PAGINA)).toBe(1);
    expect(totalPaginas(TAMANIO_PAGINA + 1)).toBe(2);
  });

  it('traduce los estados de Mercado Pago y deja los desconocidos como vienen', () => {
    expect(etiquetaEstadoPago('approved')).toBe('Aprobado');
    expect(etiquetaEstadoPago('refunded')).toBe('Devuelto');
    expect(etiquetaEstadoPago('otro_estado')).toBe('otro_estado');
  });

  it('muestra las fechas en hora de Buenos Aires, con o sin zona', () => {
    // 15:30 UTC son las 12:30 en Buenos Aires
    expect(formatearFechaHora('2026-11-14T15:30:00Z')).toContain('12:30');
    expect(formatearFechaHora('2026-11-14T15:30:00')).toContain('12:30');
    expect(formatearFechaHora('2026-11-14T15:30:00+00:00')).toContain('12:30');
  });
});
