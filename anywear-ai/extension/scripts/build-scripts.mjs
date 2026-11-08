/**
 * Bundles the extension content script and background service worker as
 * self-contained IIFE files (content scripts cannot be ES modules).
 * Runs after the popup build.
 */
import esbuild from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "..", "src");
const out = path.join(root, "..", "dist");

const common = {
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  minify: true,
  legalComments: "none",
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(src, "content", "main.ts")],
  outfile: path.join(out, "content.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(src, "background", "main.ts")],
  outfile: path.join(out, "background.js"),
});

console.log("extension scripts bundled → dist/content.js, dist/background.js");
