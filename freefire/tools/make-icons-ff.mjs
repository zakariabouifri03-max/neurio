// Generates icons/icon-192.png, icon-512.png, icon-maskable-512.png
//   node tools/make-icons-ff.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drawIcon, encodePNG } from './icon-art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'icons');

mkdirSync(outDir, { recursive: true });
for (const [size, name, maskable] of [[192, 'icon-192.png', false], [512, 'icon-512.png', false], [512, 'icon-maskable-512.png', true]]) {
  const c = drawIcon(size, maskable);
  writeFileSync(join(outDir, name), encodePNG(c.px, size, size));
  console.log('wrote icons/' + name + ' (' + size + '×' + size + ')');
}
