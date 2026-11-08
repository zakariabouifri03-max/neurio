/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Popup page build (ESM web app). Content script and background service
// worker are bundled separately with esbuild (scripts/build-scripts.mjs)
// as self-contained IIFE files — content scripts cannot be ES modules.
export default defineConfig({
  plugins: [react()],
  // Relative asset paths are required: the extension loads from
  // chrome-extension://<id>/..., not from a web root.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
