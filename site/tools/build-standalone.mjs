#!/usr/bin/env node
/**
 * Build a single, fully self-contained HTML file from site/.
 *
 *   node site/tools/build-standalone.mjs
 *   → site/neurio-standalone.html
 *
 * Fonts, styles, script and hero image are inlined as data URIs, so the file
 * works when opened directly from disk or uploaded on its own to any host.
 *
 * Note: every replacement uses a function, never a string — otherwise `$$`
 * inside the JS source would be treated as a special replace pattern.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const readBin = (p) => fs.readFileSync(path.join(root, p));
const b64 = (p, type) => `data:${type};base64,${readBin(p).toString("base64")}`;

let html = read("index.html");
let css = read("assets/styles.css");
const js = read("assets/app.js");

/* --- fonts: inline the latin variable face, drop the unused italic face --- */
const fontNormal = b64("assets/fonts/inter-latin-wght-normal.woff2", "font/woff2");
css = css.replace(
  /@font-face\s*{[^}]*font-style:\s*italic;[^}]*}/g,
  () => "/* italic face omitted in the standalone build */"
);
css = css.replace(
  /url\("fonts\/inter-latin-wght-normal\.woff2"\)/,
  () => `url("${fontNormal}")`
);

/* --- hero image + drop the duplicated og:image meta --- */
const hero = b64("assets/hero-ambient-light.jpg", "image/jpeg");
html = html.replace(/\s*<meta property="og:image"[^>]*\/>/, () => "");
html = html.replaceAll("assets/hero-ambient-light.jpg", () => hero);

/* --- css + js inlined --- */
html = html.replace(
  /<link rel="preload"[^>]*\/>\s*/,
  () => ""
);
html = html.replace(
  /<link rel="stylesheet" href="assets\/styles\.css" \/>/,
  () => `<style>\n${css}\n</style>`
);
html = html.replace(
  /<script src="assets\/app\.js" defer><\/script>/,
  () => `<script>\n${js}\n</script>`
);

const out = path.join(root, "neurio-standalone.html");
fs.writeFileSync(out, html);
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`✓ neurio-standalone.html written (${kb} KB)`);
