import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';
import a11yConfig from './eslint.a11y.config.js';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'eslint.config.js',
      'eslint.a11y.config.js',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // Reglas estrictas que pide el DoD
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Le decimos que los errores de formato de Prettier los marque como errores de linter
      'prettier/prettier': 'error',
    },
  },
  // Accesibilidad (Sub-issue 27.1)
  ...a11yConfig,
  prettierConfig
);
