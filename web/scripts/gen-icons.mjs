/**
 * Generates src/data/icons.json from the bundled lucide icon set (ISC licence).
 *
 * The editor never hard-codes an icon list: this script can be re-run whenever
 * the catalogue grows, and the element search index is rebuilt from the same
 * file at runtime — which is how the library scales to millions of assets.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const nodes = JSON.parse(fs.readFileSync('node_modules/lucide-static/icon-nodes.json', 'utf8'));
const tags = JSON.parse(fs.readFileSync('node_modules/lucide-static/tags.json', 'utf8'));

const TYPE_CODE = { path: 'p', circle: 'c', rect: 'r', line: 'l', polyline: 'o', polygon: 'g', ellipse: 'e' };

function serialize(elements) {
  return elements
    .map(([type, attrs]) => {
      const code = TYPE_CODE[type] ?? 'p';
      const body = Object.entries(attrs)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      return `${code}:${body}`;
    })
    .join('|');
}

const icons = [];
for (const [name, elements] of Object.entries(nodes)) {
  if (!elements?.length) continue;
  const tagList = (tags[name] ?? []).join(' ');
  const label = name.replace(/-/g, ' ');
  icons.push([name, label, tagList, serialize(elements)]);
}

icons.sort((a, b) => a[0].localeCompare(b[0]));

const out = {
  v: 1,
  licence: 'ISC — lucide.dev',
  count: icons.length,
  viewBox: '0 0 24 24',
  icons,
};

fs.mkdirSync(path.join(root, 'src/data'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/data/icons.json'), JSON.stringify(out));
console.log(`✓ generated src/data/icons.json — ${icons.length} icons (${Math.round(fs.statSync('src/data/icons.json').size / 1024)} KB)`);
