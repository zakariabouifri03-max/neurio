// Builds the self-contained web bundle the Android WebView loads, plus launcher icons.
//   node tools/build-android-assets.mjs
// Output: android/app/src/main/assets/www/index.html + res/mipmap-*/ic_launcher.png
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { draw, encodePNG } from "./sawt-png.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");

// 1. Bundle app.js + audio.js into one classic script (WebView loads from file://).
const bundle = await build({
  entryPoints: [new URL("../src/sawt/app.js", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  target: "es2020",
  write: false,
  minify: true,
});
const js = bundle.outputFiles[0].text;

// 2. CSS with fonts inlined as data URLs.
let css = read("src/sawt/style.css");
css = css.replace(/url\("\.\.\/\.\.\/assets\/fonts\/([^"]+)"\)/g, (_, file) => {
  const data = fs.readFileSync(new URL(`assets/fonts/${file}`, root));
  return `url("data:font/woff2;base64,${data.toString("base64")}")`;
});

// 3. HTML: inline everything, drop install-time links.
const favicon = fs.readFileSync(new URL("icons/sawt.svg", root));
let html = read("index.html");
html = html
  .replace(
    /<link rel="icon"[^>]*>/,
    `<link rel="icon" href="data:image/svg+xml;base64,${favicon.toString("base64")}" />`,
  )
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, "")
  .replace(/<link rel="manifest"[^>]*>\s*/, "")
  .replace(/<link rel="preload"[^>]*>\s*/g, "")
  .replace(
    /<link rel="stylesheet" href="src\/sawt\/style.css" \/>/,
    `<style>\n${css}\n</style>`,
  )
  .replace(
    /<script type="module" src="src\/sawt\/app.js"><\/script>/,
    `<script>\n${js}\n</script>`,
  );

if (html.includes("src/sawt/") || html.includes('type="module"'))
  throw new Error("bundle left external references behind");

const www = new URL("../android/app/src/main/assets/www/", import.meta.url);
fs.mkdirSync(www, { recursive: true });
fs.writeFileSync(new URL("index.html", www), html);

// 4. Launcher icons for every density.
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, n] of Object.entries(sizes)) {
  const dir = new URL(
    `../android/app/src/main/res/mipmap-${density}/`,
    import.meta.url,
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    new URL("ic_launcher.png", dir),
    encodePNG(draw(n).px, n, n),
  );
}

const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(
  `android assets ready — www/index.html ${kb} KB, launcher icons ${Object.keys(sizes).length} densities`,
);
