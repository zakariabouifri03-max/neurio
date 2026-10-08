import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const alias = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Bind 0.0.0.0 so the app is reachable from outside the container / dev machine.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': alias('./src'),
      '@core': alias('./src/core'),
      '@ui': alias('./src/ui'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // Allow arbitrary preview hosts (Tauri dev server / sandboxed preview).
    allowedHosts: true,
    hmr: { protocol: 'ws' },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  // FFmpeg.wasm needs these headers when the optional web export backend is used.
  optimizeDeps: { exclude: ['@tauri-apps/api'] },
});
