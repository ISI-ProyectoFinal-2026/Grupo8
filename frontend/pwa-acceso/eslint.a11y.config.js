import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

/**
 * Reglas de accesibilidad (Sub-issue 27.1). Está en un archivo aparte para poder correrlas
 * solas en el CI (`npm run lint:a11y`): el lint completo todavía tiene errores de formato
 * de Prettier que no son parte de esta issue. `eslint.config.js` también las incluye.
 */
export default tseslint.config({
  files: ['src/**/*.tsx'],
  // Los tests arman componentes de prueba que no son pantallas reales
  ignores: ['src/**/*.test.tsx', 'src/__tests__/**'],
  ...jsxA11y.flatConfigs.recommended,
  languageOptions: {
    ...jsxA11y.flatConfigs.recommended.languageOptions,
    parser: tseslint.parser,
  },
  settings: {
    // Los componentes de shadcn/ui se revisan como el elemento HTML que dibujan
    'jsx-a11y': {
      components: {
        Button: 'button',
        Input: 'input',
        Label: 'label',
        Textarea: 'textarea',
      },
    },
  },
});
