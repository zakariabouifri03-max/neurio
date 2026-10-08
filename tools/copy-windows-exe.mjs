import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const files = await fs.readdir(release).catch(() => []);
const candidates = files.filter((file) => /^AI-Download-Manager-Pro-\d[^/]*\.exe$/i.test(file) && !/-Setup-/i.test(file));
if (!candidates.length) {
  console.error('Could not locate the portable Windows executable in release/. Build the portable target first.');
  process.exitCode = 1;
} else {
  const candidate = candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  await fs.copyFile(path.join(release, candidate), path.join(release, 'AI-Download-Manager-Pro.exe'));
  console.log(`Created release/AI-Download-Manager-Pro.exe from ${candidate}`);
}
