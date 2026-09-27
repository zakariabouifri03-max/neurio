import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages project URLs too.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
});
