import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': `${root}shared`,
      '@server': `${root}server`,
      '@': `${root}src`,
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // node:sqlite + ws are happiest in a single forked process per file.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // node:sqlite is a Node 22 builtin that Vite's builtin list predates —
    // load it natively instead of letting vite-node try to bundle it.
    server: { deps: { external: ['node:sqlite', 'ws'] } },
    reporters: process.env.CI ? ['default'] : ['default'],
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts', 'shared/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', 'src/main.tsx'],
    },
  },
});
