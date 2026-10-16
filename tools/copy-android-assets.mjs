import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'android/app/src/main/assets/www');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of ['clearcall.webmanifest', 'icons/nour.svg', 'src/clearcall']) {
  const destination = resolve(output, entry);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, entry), destination, { recursive: true });
}

let html = await readFile(resolve(root, 'index.html'), 'utf8');
// The Android APK contains Nour Studio only; don't leave a link to a game that isn't bundled.
html = html.replace(/<a class="play-link" href="blockyard\.html">[\s\S]*?<\/a>/, '');
// Open the official OBS download page in the external browser rather than inside this WebView.
html = html.replace(' target="_blank" rel="noreferrer"', ' rel="noreferrer"');
await writeFile(resolve(output, 'index.html'), html);
console.log(`Android web assets prepared in ${output}`);
