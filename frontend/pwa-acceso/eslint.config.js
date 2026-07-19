import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'eslint.config.js'] },
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
  prettierConfig
);