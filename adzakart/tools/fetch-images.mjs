#!/usr/bin/env node
/**
 * Mirror every design image into assets/designs/ and switch the store to
 * self-hosted files (no more Etsy CDN dependency).
 *
 *   node tools/fetch-images.mjs
 *   python3 tools/build_catalog.py --local
 *
 * Images are saved as assets/designs/<listing-id>.jpg. Already-downloaded
 * files are skipped, so it is safe to re-run after adding new designs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const catalog = JSON.parse(await fs.readFile(path.join(root, "data/catalog.json"), "utf8"));
const outDir = path.join(root, "assets/designs");
await fs.mkdir(outDir, { recursive: true });

const map = {};
let downloaded = 0;
let skipped = 0;
let failed = 0;

async function grab(design) {
  const rel = `assets/designs/${design.id}.jpg`;
  const dest = path.join(root, rel);
  map[design.id] = rel;
  try {
    const stat = await fs.stat(dest);
    if (stat.size > 1000) { skipped++; return; }
  } catch {}
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(design.imageCard, { referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error("file too small");
      await fs.writeFile(dest, buf);
      downloaded++;
      return;
    } catch (err) {
      if (attempt === 3) {
        failed++;
        console.warn(`  ! ${design.id}: ${err.message}`);
      } else {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
}

const queue = catalog.designs.slice();
const workers = Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const design = queue.shift();
    if (design) await grab(design);
  }
});
await Promise.all(workers);

await fs.writeFile(
  path.join(root, "data/local-images.json"),
  JSON.stringify(map, null, 1) + "\n",
  "utf8"
);

console.log(`\nDownloaded ${downloaded}, skipped ${skipped}, failed ${failed}.`);
console.log("Wrote data/local-images.json");
if (failed === 0) {
  console.log("Next: python3 tools/build_catalog.py --local");
} else {
  console.log("Re-run to retry the failed files before building with --local.");
}
