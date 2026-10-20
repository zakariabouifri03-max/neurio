import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { Resvg } from '@resvg/resvg-js';

const sourceDir = new URL('../downloads/weekend-club/', import.meta.url);
const root = new URL('../', import.meta.url);
const outputDir = join(root.pathname, 'downloads');
const svgFiles = readdirSync(sourceDir).filter(file => file.endsWith('.svg'));
for (const file of svgFiles) {
  const svg = readFileSync(new URL(file, sourceDir));
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 3000 } }).render().asPng();
  writeFileSync(new URL(file.replace(/\.svg$/, '.png'), sourceDir), png);
}

const files = {};
for (const file of [...svgFiles, ...svgFiles.map(name => name.replace(/\.svg$/, '.png')), 'README.txt', 'LICENSE.txt']) {
  files[file] = readFileSync(new URL(file, sourceDir));
}
const archive = join(outputDir, 'sunday-supply-weekend-club.zip');
writeFileSync(archive, zipSync(files, { level: 9 }));
console.log(`Created ${archive}`);
