#!/usr/bin/env node
/**
 * make-preview.mjs - generates preview.html from the real dashboard markup.
 *
 * The dashboard already runs without the extension host (platform.js falls back
 * to the engine + localStorage), so the preview is the shipped UI plus a small
 * banner and an auto-run so it opens with a finished analysis.
 *
 * Run: node tools/make-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = readFileSync(join(root, 'src/ui/dashboard.html'), 'utf8');

const bootstrap = `
  <script>
    // Preview mode: no extension host. platform.js runs the engine locally and
    // live page scanning is simulated so every screen is explorable.
    window.HWF_AUTORUN = true;
  </script>
  <style>
    .preview-ribbon {
      position: fixed; left: 14px; bottom: 14px; z-index: 60;
      background: rgba(8, 11, 22, 0.92); border: 1px solid rgba(255,255,255,0.16);
      color: #a3adc8; font: 500 11px/1.4 "Inter", system-ui, sans-serif;
      padding: 7px 11px; border-radius: 999px; backdrop-filter: blur(8px);
    }
    .preview-ribbon strong { color: #eef2ff; }
  </style>`;

const output = dashboard
  // preview.html lives at the extension root, so asset paths need the src/ui prefix.
  .replace('href="styles.css"', 'href="src/ui/styles.css"')
  .replace("from './app.js'", "from './src/ui/app.js'")
  .replace('<title>', '<title>Preview — ')
  .replace('<script type="module">', `${bootstrap}\n  <script type="module">`)
  .replace('<body class="dashboard">', '<body class="dashboard">\n  <div class="preview-ribbon"><strong>Preview</strong> · extension UI running without the Chrome host · page scanning simulated</div>');

writeFileSync(join(root, 'preview.html'), output);
console.log('✓ preview.html written');
