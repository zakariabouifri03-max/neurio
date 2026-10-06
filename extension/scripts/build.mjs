/**
 * Builds the unpacked extension into extension/dist:
 *   1. content.js (IIFE)   2. background.js (IIFE)   3. popup (HTML+assets)
 * then copies manifest.json and icons. Pass --watch for content rebuilds.
 */
import { build } from "vite";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

if (existsSync(dist)) rmSync(dist, { recursive: true });
mkdirSync(dist, { recursive: true });

const targets = ["vite.content.config.mjs", "vite.background.config.mjs", "vite.popup.config.mjs"];

for (const cfg of targets) {
  console.log(`▶ building ${cfg}`);
  await build({ root, configFile: join(root, cfg), mode: "production" });
}

cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });

// The popup HTML is emitted under dist/src/popup — hoist it to dist root
// and fix the asset paths for the new depth.
const builtHtml = join(dist, "src", "popup", "index.html");
if (existsSync(builtHtml)) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  let html = readFileSync(builtHtml, "utf8");
  html = html.replace(/\.\.\/\.\.\/assets\//g, "./assets/");
  writeFileSync(join(dist, "popup.html"), html);
  rmSync(join(dist, "src"), { recursive: true });
}

console.log(`✅ unpacked extension ready at ${dist}`);
if (watch) console.log("(watch mode: re-run after edits — vite watch is handled by your editor flow)");
