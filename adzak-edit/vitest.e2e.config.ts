import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const alias = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': alias('./src'),
      '@core': alias('./src/core'),
      '@ui': alias('./src/ui'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
});
