// ============================================================================
// Builds the Island Survival game through the REAL build pipeline and packages
// it as IslandSurvival.exe (win32 x64) via electron-packager.
// Used by GitHub Actions (a real Windows runner) — the dev sandbox is Linux
// and cannot produce/test Windows binaries itself.
// Output: dist/game/IslandSurvival-win32-x64/IslandSurvival.exe
// ============================================================================
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { templateIslandSurvival } from '../Templates/index';
import { runBuild } from '../BuildSystem/pipeline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectsRoot = path.join(root, 'Projects');

// 1. write the sample project
const project = templateIslandSurvival('Island Survival');
project.id = 'island-survival';
const projDir = path.join(projectsRoot, 'island-survival');
fs.mkdirSync(projDir, { recursive: true });
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 1));

// 2. run the real 8-stage build pipeline
const res = runBuild(
  projectsRoot, 'island-survival',
  { mode: 'Release', name: 'IslandSurvival' },
  path.join(root, 'www-runtime', 'runtime.js'),
);
console.log(res.log.join('\n'));
if (!res.ok) {
  console.error('\nBUILD FAILED:', res.error ?? '(unknown)');
  process.exit(1);
}

// 3. package the build output as a Windows exe
const outDir = path.join(root, 'dist', 'game');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync(
  `npx electron-packager "${res.outputPath}" IslandSurvival --platform=win32 --arch=x64 --out="${outDir}" --overwrite --no-prune`,
  { stdio: 'inherit', cwd: root },
);

const exe = path.join(outDir, 'IslandSurvival-win32-x64', 'IslandSurvival.exe');
if (!fs.existsSync(exe)) {
  console.error('Packager did not produce', exe);
  process.exit(1);
}
console.log('\nGAME EXE READY:', exe);
