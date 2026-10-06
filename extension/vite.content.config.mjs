import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Content script: single self-contained IIFE (MV3 requirement).
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    lib: {
      entry: "src/content/index.tsx",
      formats: ["iife"],
      name: "EtsySignal",
      fileName: () => "content.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  resolve: { dedupe: ["react", "react-dom"] },
});
