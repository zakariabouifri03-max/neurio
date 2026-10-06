import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Popup: standard HTML build (MV3 CSP allows 'self' module scripts).
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { popup: "src/popup/index.html" },
      output: { entryFileNames: "assets/[name].js", chunkFileNames: "assets/[name].js", assetFileNames: "assets/[name][extname]" },
    },
  },
  resolve: { dedupe: ["react", "react-dom"] },
});
