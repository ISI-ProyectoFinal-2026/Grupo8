import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Con la suite completa en paralelo, una máquina cargada puede tardar más de 5 s en el
    // primer test de un archivo (arranque de jsdom). Es más margen, no tests más lentos
    testTimeout: 15000,
  },
});