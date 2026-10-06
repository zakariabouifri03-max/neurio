// Build config for the STANDALONE GAME RUNTIME.
// Produces a single self-contained IIFE bundle (www-runtime/runtime.js)
// which BuildSystem inlines into the exported <Game>.html.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  build: {
    outDir: 'www-runtime',
    target: 'es2022',
    minify: true,
    lib: {
      entry: path.resolve(root, 'Engine/runtime/main.ts'),
      formats: ['iife'],
      name: 'NEXUS_RUNTIME',
      fileName: () => 'runtime.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  resolve: {
    alias: {
      '@engine': path.resolve(root, 'Engine'),
      '@editor': path.resolve(root, 'Editor'),
      '@ai': path.resolve(root, 'AIAgent'),
      '@templates': path.resolve(root, 'Templates'),
    },
  },
});
