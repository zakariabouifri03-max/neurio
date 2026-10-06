// ============================================================================
// NEXUS BUILD SYSTEM
// Real packaging pipeline:
//   Validate Project → Validate Assets → Compile Scripts → Process Assets →
//   Package Content → Create Runtime → Generate EXE package → Validate.
// Produces a fully standalone <Game>.html (runs offline, double-click) plus
// Windows packaging scripts (Launch .bat + Make-Exe.bat → real .exe via
// Electron packaging on the target machine).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { validateProject } from '../Engine/core/ops';
import { compileScript } from '../Engine/scripting/runtime';
import type { ProjectData } from '../Engine/core/types';

const ELECTRON_VERSION = '33.4.11';

export interface BuildConfig {
  mode: 'Development' | 'Release';
  name: string;        // sanitized game name (no spaces)
}

export interface BuildResult {
  ok: boolean;
  log: string[];
  error?: string;
  cause?: string;
  file?: string;
  suggestedFix?: string;
  outputPath?: string;
  htmlPath?: string;
  exeScriptPath?: string;
  sizeBytes?: number;
}

const MAX_EMBED_BYTES = 220 * 1024 * 1024; // safety cap for inlined content

export function runBuild(projectsRoot: string, projectId: string, config: BuildConfig, runtimeBundlePath = path.resolve('www-runtime/runtime.js')): BuildResult {
  const log: string[] = [];
  const t0 = Date.now();
  const projectDir = path.join(projectsRoot, projectId);
  const step = (i: number, msg: string) => log.push(`[${i}/8] ${msg}`);

  try {
    step(1, `Validating project "${projectId}"…`);
    const projectPath = path.join(projectDir, 'project.json');
    if (!fs.existsSync(projectPath)) return fail(log, 'Project file not found', projectPath, 'Save the project before building.');
    const project: ProjectData = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    log.push(`      name="${project.name}" scenes=${project.scenes.length} assets=${project.assets.length} scripts=${Object.keys(project.scripts).length}`);

    step(2, 'Validating assets…');
    const issues = validateProject(project);
    const errors = issues.filter(i => i.severity === 'error');
    for (const i of issues) log.push(`      ${i.severity === 'error' ? '✗' : '⚠'} ${i.message}`);
    if (errors.length) {
      return { ...fail(log, `${errors.length} validation error(s)`, errors[0].message, 'Open the AI Agent and ask it to fix the errors, or fix them in the Inspector.'), cause: 'validation' };
    }
    log.push('      ✓ assets valid');

    step(3, 'Compiling scripts…');
    let scriptErrors = 0;
    for (const script of Object.values(project.scripts)) {
      const compiled = compileScript(script.id, script.name, script.source, () => ({}));
      if (compiled.problem) {
        scriptErrors++;
        log.push(`      ✗ ${script.name}.js line ${compiled.problem.line}: ${compiled.problem.message}`);
      }
    }
    if (scriptErrors) {
      return { ...fail(log, `${scriptErrors} script(s) failed to compile`, 'Scripts', 'Open the Scripts panel — errors are marked. Use "Fix With AI" on each problem.'), cause: 'scripts' };
    }
    log.push(`      ✓ ${Object.keys(project.scripts).length} script(s) compile clean`);

    step(4, 'Processing assets (embedding content)…');
    const embedded: Record<string, { mime: string; base64: string; name: string }> = {};
    let totalBytes = 0;
    for (const asset of project.assets) {
      if (!asset.path) continue;
      const abs = path.join(projectDir, asset.path.replace(/^\/+/, ''));
      if (!fs.existsSync(abs)) {
        log.push(`      ⚠ missing file: ${asset.path} (asset "${asset.name}" will render as fallback)`);
        continue;
      }
      const buf = fs.readFileSync(abs);
      if (totalBytes + buf.length > MAX_EMBED_BYTES) {
        log.push(`      ⚠ skipping embed of ${asset.name} (${(buf.length / 1048576).toFixed(1)}MB) — exceeds inline budget`);
        continue;
      }
      totalBytes += buf.length;
      embedded[asset.id] = {
        mime: mimeOf(asset.path),
        base64: buf.toString('base64'),
        name: asset.name,
      };
    }
    log.push(`      ✓ embedded ${Object.keys(embedded).length} asset file(s), ${(totalBytes / 1048576).toFixed(2)} MB total`);

    step(5, 'Packaging content…');
    const gameData = {
      project: JSON.parse(JSON.stringify(project)),
      embedded,
      config: {
        mode: config.mode,
        showStats: config.mode === 'Development',
        gameName: config.name,
      },
    };

    step(6, 'Creating standalone runtime…');
    if (!fs.existsSync(runtimeBundlePath)) {
      return fail(log, 'Standalone runtime bundle missing (www-runtime/runtime.js)', runtimeBundlePath, 'Run "npm run build" in the NEXUS folder (builds editor + runtime bundles) and build again.');
    }
    const runtimeJs = fs.readFileSync(runtimeBundlePath, 'utf8');
    const dataJson = JSON.stringify(gameData).replace(/<\/script/gi, '<\\/script');
    const html = buildHtml(config.name, runtimeJs, dataJson, config.mode);

    step(7, `Generating package "${config.name}"…`);
    const buildDir = path.join(projectDir, 'Builds', config.name);
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(buildDir, 'Runtime'), { recursive: true });
    fs.mkdirSync(path.join(buildDir, 'Content'), { recursive: true });
    fs.mkdirSync(path.join(buildDir, 'Config'), { recursive: true });

    const htmlPath = path.join(buildDir, `${config.name}.html`);
    fs.writeFileSync(htmlPath, html);
    // launchers
    fs.writeFileSync(path.join(buildDir, `Launch-${config.name}.bat`),
      `@echo off\r\nstart "" "%~dp0${config.name}.html"\r\n`);
    fs.writeFileSync(path.join(buildDir, `Make-${config.name}-Exe.bat`),
      `@echo off\r\n` +
      `cd /d "%~dp0"\r\n` +
      `echo Packaging ${config.name}.exe (requires Node.js; first run downloads Electron ~100MB)\r\n` +
      `if not exist node_modules ( npm install --no-audit --no-fund )\r\n` +
      `npx electron-packager . "${config.name}" --platform=win32 --arch=x64 --out=. --overwrite\r\n` +
      `echo.\r\necho Done. Play it: ${config.name}-win32-x64\\${config.name}.exe\r\n` +
      `pause\r\n`);
    // electron wrapper + ROOT manifest so electron-packager packages the whole
    // build folder (game html + Runtime + Content + Config) into the exe
    fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({
      name: config.name.toLowerCase(),
      version: '1.0.0',
      main: 'Runtime/electron-main.cjs',
      description: `${config.name} — built with NEXUS GAME STUDIO`,
      scripts: { start: 'electron .' },
      devDependencies: { electron: ELECTRON_VERSION, 'electron-packager': '^17.1.2' },
    }, null, 2));
    fs.writeFileSync(path.join(buildDir, 'Runtime', 'electron-main.cjs'), electronMain(config.name));
    // content copy (raw assets for modding)
    const contentSrc = path.join(projectDir, 'Content');
    if (fs.existsSync(contentSrc)) fs.cpSync(contentSrc, path.join(buildDir, 'Content'), { recursive: true });
    // config
    fs.writeFileSync(path.join(buildDir, 'Config', 'game.json'), JSON.stringify({
      name: config.name, mode: config.mode, entryScene: project.settings.entrySceneId,
      graphicsQuality: project.settings.graphicsQuality, builtAt: new Date().toISOString(),
      engine: 'NEXUS GAME STUDIO 1.0',
    }, null, 2));
    fs.writeFileSync(path.join(buildDir, 'README.txt'), readme(config.name, config.mode));

    step(8, 'Running validation…');
    const reread = fs.readFileSync(htmlPath, 'utf8');
    if (!reread.includes('NEXUS_RUNTIME')) return fail(log, 'Runtime bundle missing from output HTML', htmlPath, 'Rebuild the editor bundles.');
    const payloadMatch = reread.match(/window\.NEXUS_GAME\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!payloadMatch) return fail(log, 'Game data payload missing from output HTML', htmlPath, 'Report this as a bug.');
    JSON.parse(payloadMatch[1].replace(/<\\\/script/gi, '</script')); // round-trip check
    const size = fs.statSync(htmlPath).size;
    if (size < 1024) return fail(log, 'Output suspiciously small', htmlPath, 'Check the runtime bundle build.');
    log.push(`      ✓ HTML ${ (size / 1048576).toFixed(2) } MB, payload OK, runtime OK`);

    // build.log
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log.push(`──── BUILD COMPLETE in ${elapsed}s ────`);
    log.push(`      Output: ${buildDir}`);
    fs.writeFileSync(path.join(buildDir, 'build.log'), log.join('\n') + '\n');

    return {
      ok: true, log,
      outputPath: buildDir,
      htmlPath: htmlPath,
      exeScriptPath: path.join(buildDir, `Make-${config.name}-Exe.bat`),
      sizeBytes: size,
    };
  } catch (e: any) {
    return fail(log, e?.message ?? String(e), e?.stack?.split('\n')[1] ?? '', 'Check the Output panel details.');
  }
}

function fail(log: string[], error: string, file = '', suggestedFix = ''): BuildResult {
  log.push(`──── BUILD FAILED ────`);
  log.push(`      Cause: ${error}`);
  if (file) log.push(`      File: ${file}`);
  if (suggestedFix) log.push(`      Suggested fix: ${suggestedFix}`);
  return { ok: false, log, error, file, suggestedFix, cause: error };
}

function mimeOf(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream',
    '.obj': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  };
  return map[ext] ?? 'application/octet-stream';
}

function buildHtml(name: string, runtimeJs: string, dataJson: string, mode: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#07090d}
  #load{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#7fd8e8;font-family:monospace;letter-spacing:3px;font-size:13px;z-index:9}
  #load .bar{width:220px;height:3px;background:#17222d;margin-top:14px;border-radius:2px;overflow:hidden}
  #load .bar i{display:block;height:100%;width:40%;background:#22d3ee;animation:slide 1s infinite}
  @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
</style>
</head>
<body>
<!-- NEXUS_RUNTIME -->
<div id="load">NEXUS RUNTIME — ${escapeHtml(name)} [${mode}]<div class="bar"><i></i></div></div>
<script>
window.NEXUS_GAME = ${dataJson};
</script>
<script>
${runtimeJs}
</script>
<script>
// the runtime auto-boots when NEXUS_GAME is present; remove the loading screen.
(function(){
  var n = 0;
  var t = setInterval(function(){
    if (document.getElementById('load')) { var l = document.getElementById('load'); l && l.remove(); clearInterval(t); }
    if (++n > 200) clearInterval(t);
  }, 30);
})();
</script>
</body>
</html>`;
}

function electronMain(name: string): string {
  return `// ${name} — NEXUS standalone game (Electron wrapper)
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, title: ${JSON.stringify(name)},
    backgroundColor: '#07090d', autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', ${JSON.stringify(name + '.html')}));
  win.once('ready-to-show', () => win.maximize());
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
`;
}

function readme(name: string, mode: string): string {
  return `${name} — built with NEXUS GAME STUDIO (${mode})
=====================================================

HOW TO PLAY
-----------
Double-click ${name}.html — it opens in your browser and runs
completely offline (all engine code and content are embedded).

Windows EXE
-----------
Double-click Make-${name}-Exe.bat (requires Node.js installed).
It packages this whole folder with Electron into a real
${name}-win32-x64/${name}.exe (first run downloads Electron, ~100 MB).

Files
-----
${name}.html          The game (single-file, offline)
Launch-${name}.bat    Starts the game in your default browser
Make-${name}-Exe.bat  Builds ${name}.exe (Windows + Node.js required)
Runtime/              Electron wrapper sources for EXE packaging
Content/              Original project assets (for modding)
Config/game.json      Build configuration
build.log             Full build pipeline log
`;
}

function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
