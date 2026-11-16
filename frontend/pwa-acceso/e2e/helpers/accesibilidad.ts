import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

/** Reglas de axe que corresponden a WCAG 2.0, 2.1 y 2.2, niveles A y AA. */
export const ETIQUETAS_WCAG = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

/** El criterio de la Issue 27: no puede quedar ningún problema grave ni crítico. */
const IMPACTOS_QUE_FALLAN = ['serious', 'critical'];

type Problema = Awaited<
  ReturnType<AxeBuilder['analyze']>
>['violations'][number];

/** Una línea por problema: regla, gravedad, qué pide y los primeros elementos afectados. */
function describir(problema: Problema): string {
  const elementos = problema.nodes
    .slice(0, 5)
    .map((nodo) => nodo.target.join(' '))
    .join(' | ');
  return `${problema.id} (${problema.impact}): ${problema.help} → ${elementos}`;
}

/**
 * Corre axe sobre lo que muestra la página en este momento.
 * Falla si hay problemas graves o críticos. Los moderados y leves no hacen fallar la prueba,
 * pero quedan anotados en el informe para revisarlos en la 27.2, 27.3 y 27.4.
 * El resultado completo se adjunta al informe HTML (`npm run test:e2e:informe`).
 */
export async function revisarAccesibilidad(
  page: Page,
  testInfo: TestInfo
): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .withTags(ETIQUETAS_WCAG)
    .analyze();

  await testInfo.attach('axe-problemas.json', {
    body: JSON.stringify(resultado.violations, null, 2),
    contentType: 'application/json',
  });

  const graves = resultado.violations.filter((problema) =>
    IMPACTOS_QUE_FALLAN.includes(problema.impact ?? '')
  );
  const menores = resultado.violations.filter(
    (problema) => !graves.includes(problema)
  );
  for (const problema of menores) {
    testInfo.annotations.push({
      type: 'axe (moderado o leve)',
      description: describir(problema),
    });
  }

  expect(
    graves.map(describir),
    'axe encontró problemas de accesibilidad graves o críticos'
  ).toEqual([]);
}
