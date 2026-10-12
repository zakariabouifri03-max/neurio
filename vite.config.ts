import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  root,
  resolve: {
    alias: {
      '@shared': `${root}shared`,
      '@': `${root}src`,
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Reached through a reverse proxy / tunnel host in hosted dev environments.
    allowedHosts: true,
    // The Electron/dev renderer talks to the local API; proxying keeps
    // everything same-origin so no CORS juggling is needed in the browser.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8790', changeOrigin: true },
      '/gateway': { target: 'ws://127.0.0.1:8790', ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8790', changeOrigin: true },
      '/gateway': { target: 'ws://127.0.0.1:8790', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  define: {
    __NEURIO_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
  },
});
