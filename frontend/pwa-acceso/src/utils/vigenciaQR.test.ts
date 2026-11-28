// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  diaEnArgentina,
  evaluarVigenciaQR,
  MENSAJE_QR_FUERA_DE_FECHA,
} from './vigenciaQR';

// Estadía del 27 al 29 de noviembre de 2026. Como en el backend, `exp` es la medianoche de
// Argentina (03:00 UTC) del día siguiente al egreso: el 30/11
const EXP_FIN_DE_ESTADIA = Date.UTC(2026, 10, 30, 3, 0, 0) / 1000;
const QR_NUEVO = {
  dat: '2026-11-27',
  egr: '2026-11-29',
  exp: EXP_FIN_DE_ESTADIA,
};
// Emitido antes de la 28.1: trae dat y exp, pero no egr
const QR_VIEJO = { dat: '2026-11-27', exp: EXP_FIN_DE_ESTADIA };

// Las horas se escriben con la hora de Buenos Aires (-03:00)
const enArgentina = (fechaHora: string) => new Date(`${fechaHora}-03:00`);

const CASOS: Array<[string, string, boolean]> = [
  ['día anterior (26/11, último segundo)', '2026-11-26T23:59:59', false],
  ['primer día (27/11, primer segundo)', '2026-11-27T00:00:00', true],
  ['día del medio (28/11)', '2026-11-28T12:00:00', true],
  ['último día (29/11, último segundo)', '2026-11-29T23:59:59', true],
  ['día posterior (30/11, primer segundo)', '2026-11-30T00:00:00', false],
  // 22:30 en Argentina es 01:30 UTC del día siguiente: con la fecha UTC se equivocaría en los dos bordes
  [
    'último día a las 22:30 (en UTC ya es el 30/11)',
    '2026-11-29T22:30:00',
    true,
  ],
  [
    'día anterior a las 22:30 (en UTC ya es el 27/11)',
    '2026-11-26T22:30:00',
    false,
  ],
];

describe('evaluarVigenciaQR (Issue 28.1)', () => {
  it.each(CASOS)('QR con egr: %s', (_nombre, hora, vigente) => {
    expect(evaluarVigenciaQR(QR_NUEVO, enArgentina(hora)).vigente).toBe(
      vigente
    );
  });

  it.each(CASOS)(
    'QR emitido antes de la 28.1 (sin egr, se deduce de exp): %s',
    (_nombre, hora, vigente) => {
      expect(evaluarVigenciaQR(QR_VIEJO, enArgentina(hora)).vigente).toBe(
        vigente
      );
    }
  );

  it('distingue si el QR es de un día que todavía no llegó o de uno que ya pasó', () => {
    expect(
      evaluarVigenciaQR(QR_NUEVO, enArgentina('2026-11-26T12:00:00'))
    ).toEqual({
      vigente: false,
      motivo: 'ANTES_DEL_INGRESO',
    });
    expect(
      evaluarVigenciaQR(QR_NUEVO, enArgentina('2026-11-30T12:00:00'))
    ).toEqual({
      vigente: false,
      motivo: 'DESPUES_DEL_EGRESO',
    });
  });

  it('un QR de un solo día (dat = egr) vale ese día entero y ninguno más', () => {
    const unDia = {
      dat: '2026-11-27',
      egr: '2026-11-27',
      exp: Date.UTC(2026, 10, 28, 3, 0, 0) / 1000,
    };

    expect(
      evaluarVigenciaQR(unDia, enArgentina('2026-11-26T23:59:59')).vigente
    ).toBe(false);
    expect(
      evaluarVigenciaQR(unDia, enArgentina('2026-11-27T00:00:00')).vigente
    ).toBe(true);
    expect(
      evaluarVigenciaQR(unDia, enArgentina('2026-11-27T23:59:59')).vigente
    ).toBe(true);
    expect(
      evaluarVigenciaQR(unDia, enArgentina('2026-11-28T00:00:00')).vigente
    ).toBe(false);
  });

  it('si el QR trae egr, manda egr y no exp', () => {
    // exp apunta al 30/11 pero egr dice 28/11: el 29 ya no vale
    const acortado = {
      dat: '2026-11-27',
      egr: '2026-11-28',
      exp: EXP_FIN_DE_ESTADIA,
    };

    expect(
      evaluarVigenciaQR(acortado, enArgentina('2026-11-29T12:00:00')).vigente
    ).toBe(false);
  });

  it.each<[string, Parameters<typeof evaluarVigenciaQR>[0]]>([
    ['sin dat', { exp: EXP_FIN_DE_ESTADIA } as never],
    [
      'dat que no es una fecha',
      { dat: '27/11/2026', egr: '2026-11-29', exp: EXP_FIN_DE_ESTADIA },
    ],
    [
      'dat con hora',
      {
        dat: '2026-11-27T00:00:00',
        egr: '2026-11-29',
        exp: EXP_FIN_DE_ESTADIA,
      },
    ],
    [
      'egr que no es una fecha',
      { dat: '2026-11-27', egr: 'mañana', exp: EXP_FIN_DE_ESTADIA },
    ],
    [
      'egr anterior a dat',
      { dat: '2026-11-29', egr: '2026-11-27', exp: EXP_FIN_DE_ESTADIA },
    ],
    ['sin egr y sin exp usable', { dat: '2026-11-27', exp: Number.NaN }],
  ])(
    'rechaza un QR con fechas ilegibles (%s) sin adivinar un rango',
    (_nombre, payload) => {
      expect(
        evaluarVigenciaQR(payload, enArgentina('2026-11-28T12:00:00'))
      ).toEqual({
        vigente: false,
        motivo: 'FECHAS_INVALIDAS',
      });
    }
  );

  it('el mensaje para el guardia es el de la issue', () => {
    expect(MENSAJE_QR_FUERA_DE_FECHA).toBe('Este QR no es válido para hoy');
  });
});

describe('diaEnArgentina (Issue 28.1)', () => {
  it.each([
    ['2026-11-27T00:00:00Z', '2026-11-26'], // 21:00 en Argentina: UTC ya cambió de día
    ['2026-11-27T01:30:00Z', '2026-11-26'], // 22:30
    ['2026-11-27T02:59:59Z', '2026-11-26'], // 23:59:59
    ['2026-11-27T03:00:00Z', '2026-11-27'], // medianoche argentina
    ['2026-11-27T14:00:00Z', '2026-11-27'],
  ])('%s en UTC es el %s en Buenos Aires', (instanteUtc, dia) => {
    expect(diaEnArgentina(new Date(instanteUtc))).toBe(dia);
  });

  it('a las 22:30 de Argentina la fecha UTC se adelanta: por eso no se usa toISOString', () => {
    const instante = enArgentina('2026-11-26T22:30:00');

    expect(instante.toISOString().slice(0, 10)).toBe('2026-11-27'); // el error que se evita
    expect(diaEnArgentina(instante)).toBe('2026-11-26');
  });

  it('da el mismo día aunque el celular del guardia tenga otra zona horaria configurada', () => {
    const instante = enArgentina('2026-11-26T22:30:00');
    try {
      for (const zona of [
        'UTC',
        'Asia/Tokyo',
        'Pacific/Auckland',
        'America/Los_Angeles',
      ]) {
        vi.stubEnv('TZ', zona);
        expect(diaEnArgentina(instante), zona).toBe('2026-11-26');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
