import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'www',
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      '@engine': path.resolve(root, 'Engine'),
      '@editor': path.resolve(root, 'Editor'),
      '@ai': path.resolve(root, 'AIAgent'),
      '@templates': path.resolve(root, 'Templates'),
    },
  },
  server: { host: true, port: 5173 },
});
