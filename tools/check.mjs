import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
let failures = 0;
for (const folder of ['src/clearcall', 'src/blockyard', 'src/raft']) {
  for (const name of readdirSync(folder).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', `${folder}/${name}`], { encoding: 'utf8' });
    if (result.status) { console.error(result.stderr); failures++; }
  }
}
for (const path of ['clearcall.webmanifest', 'manifest.webmanifest', 'drift.webmanifest']) JSON.parse(readFileSync(path, 'utf8'));
if (failures) process.exit(1);
console.log('Nour Studio, Blockyard, Drift, and all three web manifests are valid.');
