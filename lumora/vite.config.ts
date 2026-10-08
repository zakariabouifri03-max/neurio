import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { host: '0.0.0.0', port: 5174, strictPort: true, cors: true, allowedHosts: true },
  build: { outDir: 'dist-renderer', emptyOutDir: true, target: 'chrome120', sourcemap: false }
});
