import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@engine': path.resolve(root, 'Engine'),
      '@editor': path.resolve(root, 'Editor'),
      '@ai': path.resolve(root, 'AIAgent'),
      '@templates': path.resolve(root, 'Templates'),
    },
  },
  test: {
    environment: 'node',
    env: { NEXUS_NO_SERVE: '1' },
    testTimeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
});
