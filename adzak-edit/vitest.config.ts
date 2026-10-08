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
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/core/**', 'src/ui/store/**'] },
  },
});
