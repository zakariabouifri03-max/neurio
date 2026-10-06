import { defineConfig } from "vite";

// Background service worker: single self-contained IIFE.
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    lib: {
      entry: "src/background/index.ts",
      formats: ["iife"],
      name: "EtsySignalBackground",
      fileName: () => "background.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
