import { defineConfig } from "vite";

/**
 * The Tauri CLI starts this dev server and points the webview at it.
 *
 * `SWIFTLOAD_DEV_HOST` lets the same configuration serve the UI to a remote
 * browser (used for UI review); the default stays on loopback so a development
 * machine never exposes the dev server to the network by accident.
 */
const host = process.env.SWIFTLOAD_DEV_HOST ?? "127.0.0.1";
const port = Number(process.env.SWIFTLOAD_DEV_PORT ?? 1420);

export default defineConfig({
  clearScreen: false,
  server: {
    host,
    port,
    strictPort: true,
    watch: {
      // Rust sources are rebuilt by cargo, not by Vite.
      ignored: ["**/src-tauri/**", "**/dist/**"],
    },
  },
  build: {
    // WebView2 on Windows 10/11 ships a modern Chromium.
    target: "chrome105",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: false,
  },
});
