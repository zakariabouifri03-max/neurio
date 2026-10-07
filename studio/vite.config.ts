import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { cpSync, existsSync, mkdirSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const mpWasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');

/** Serves MediaPipe's wasm runtime at /mediapipe/wasm in dev and copies it into dist on build (keeps 30 MB of binaries out of git). */
function mediapipeWasm(): Plugin {
  return {
    name: 'neurio-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const file = resolve(mpWasmSrc, '.' + (req.url || '/').split('?')[0]);
        if (!file.startsWith(mpWasmSrc) || !existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = resolve(root, 'dist/mediapipe/wasm');
      if (!existsSync(mpWasmSrc)) return;
      mkdirSync(out, { recursive: true });
      cpSync(mpWasmSrc, out, { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), mediapipeWasm()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-node', '@mediapipe/tasks-vision'] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    headers: {
      // Enables SharedArrayBuffer (multi-threaded wasm for Whisper / MediaPipe). Cross-origin assets must be CORS-enabled (Google Fonts & HF are).
      // Disabled by default because it blocks non-CORP third-party resources; flip on if you want threaded inference.
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
});
