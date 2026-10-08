import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * electron-vite drives three builds:
 *  - main     -> Node/Electron main process (CJS, deps externalised)
 *  - preload  -> contextBridge preload (CJS, sandboxed)
 *  - renderer -> React app served by Vite in dev, bundled for production
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/main',
      sourcemap: true,
      rollupOptions: {
        input: resolve('src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/preload',
      sourcemap: true,
      rollupOptions: {
        input: resolve('src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    base: './',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      outDir: resolve('out/renderer'),
      sourcemap: true,
      chunkSizeWarningLimit: 2400,
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
        output: {
          manualChunks: {
            pdf: ['jspdf'],
            icons: ['lucide-react']
          }
        }
      }
    }
  }
})
