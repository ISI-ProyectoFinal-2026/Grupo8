import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensajeMotivoSocio, validarSocio, type ValidacionSocio } from './validacionSocio';

const SOCIO_VIGENTE: ValidacionSocio = {
  valido: true,
  motivo: null,
  nombre: 'Ana Pérez',
  condicion: 'socio',
};

describe('validarSocio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('consulta GET /socios/validar/{dni} y devuelve lo que responde el backend', async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true, json: async () => SOCIO_VIGENTE });
    vi.stubGlobal('fetch', fetchFalso);

    const resultado = await validarSocio(' 41234567 ');

    expect(resultado).toEqual(SOCIO_VIGENTE);
    expect(String(fetchFalso.mock.calls[0][0])).toMatch(/\/socios\/validar\/41234567$/);
  });

  it('devuelve el motivo cuando el socio no es válido', async () => {
    const rechazo: ValidacionSocio = {
      valido: false,
      motivo: 'CUOTA_VENCIDA',
      nombre: null,
      condicion: null,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rechazo }));

    expect(await validarSocio('41234567')).toEqual(rechazo);
  });

  it('falla si el backend no responde bien', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(validarSocio('41234567')).rejects.toThrow();
  });
});

describe('mensajeMotivoSocio', () => {
  it('da un mensaje distinto para cada motivo', () => {
    const mensajes = [
      mensajeMotivoSocio('NO_EXISTE'),
      mensajeMotivoSocio('NO_ES_SOCIO'),
      mensajeMotivoSocio('CUOTA_VENCIDA'),
    ];

    expect(new Set(mensajes).size).toBe(3);
    expect(mensajes[2]).toMatch(/vencida/i);
  });

  it('tiene un mensaje genérico si no hay motivo', () => {
    expect(mensajeMotivoSocio(null)).toMatch(/no pudimos validar/i);
  });
});