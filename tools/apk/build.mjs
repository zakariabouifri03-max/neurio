#!/usr/bin/env node
// Builds dist/BashBaqiRacing.apk from scratch, offline:
//
//   1. esbuild     -> the whole game bundled into one self-contained HTML file
//   2. make-icons  -> launcher icons (legacy densities + adaptive foreground)
//   3. apktool     -> smali + res + assets -> unsigned APK   (no Gradle, no Android SDK)
//   4. sign.mjs    -> APK Signature Scheme v2
//   5. verify.py   -> independent check of the signature, zip and dex
//
// Tool locations can be overridden with env vars:
//   JAVA, APKTOOL_JAR, APKTOOLS_MODULES (node_modules with esbuild +
//   apk_sign_ts), AAPT2, APK_OUT
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const APP = join(HERE, 'app');
const BUILD = join(HERE, 'build');
const KEYDIR = join(HERE, 'keystore');

const MODULES = process.env.APKTOOLS_MODULES || '/tmp/gb/node_modules';
const JAVA = process.env.JAVA || '/tmp/jdk/x/jdk4py/java-runtime/bin/java';
const APKTOOL = process.env.APKTOOL_JAR || '/tmp/dl/apktooln/package/bin/apktool_2.4.1.jar';
const AAPT2 = process.env.AAPT2 || '/tmp/dl/aapt2';
const OUT = process.env.APK_OUT || join(ROOT, 'dist', 'BashBaqiRacing.apk');
const KEY = join(KEYDIR, 'release.pem');
const CERT = join(KEYDIR, 'release.crt');

const step = (n, msg) => console.log(`\n\x1b[1m[${n}/5]\x1b[0m ${msg}`);

for (const f of [JAVA, APKTOOL]) {
  if (!existsSync(f)) {
    console.error(`missing tool: ${f}\nsee tools/apk/README.md for the one-time setup`);
    process.exit(2);
  }
}
mkdirSync(BUILD, { recursive: true });
mkdirSync(join(APP, 'assets'), { recursive: true });
mkdirSync(KEYDIR, { recursive: true });

// ── 1. bundle the game into a single HTML file ──────────────────────────────
step(1, 'bundling the game (esbuild)…');
const esbuild = await import(MODULES + '/esbuild/lib/main.js');
const res = await esbuild.build({
  entryPoints: [join(ROOT, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  legalComments: 'none',
  logLevel: 'silent',
  alias: {
    'three': join(ROOT, 'vendor', 'three.module.js'),
    'three/addons/utils/BufferGeometryUtils.js': join(ROOT, 'vendor', 'utils', 'BufferGeometryUtils.js'),
  },
  write: false,
});
const js = res.outputFiles[0].text;
const css = readFileSync(join(ROOT, 'src', 'style.css'), 'utf8');
const iconB64 = readFileSync(join(ROOT, 'icons', 'icon-192.png')).toString('base64');

let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="src/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replaceAll('icons/icon-192.png', () => `data:image/png;base64,${iconB64}`);
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<link rel="preconnect"[^>]*>\n?/, '');
html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/, '');  // offline: system font
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js}\n</script>`);
writeFileSync(join(APP, 'assets', 'index.html'), html);
console.log(`    assets/index.html  ${(html.length / 1024).toFixed(0)} KB`);

// ── 2. launcher icons ───────────────────────────────────────────────────────
step(2, 'drawing launcher icons…');
const { makeIcon } = await import(join(ROOT, 'tools', 'make-icons.mjs'));
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [d, s] of Object.entries(LEGACY)) {
  const dir = join(APP, 'res', `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ic_launcher.png'), makeIcon(s, false));
  writeFileSync(join(dir, 'ic_launcher_fg.png'), makeIcon(ADAPTIVE[d], true));
}
console.log('    res/mipmap-*/ic_launcher.png + ic_launcher_fg.png');

// ── 3. package (apktool: smali → dex, res + manifest → binary, assets) ──────
step(3, 'packaging the APK (apktool)…');
const unsigned = join(BUILD, 'bashbaqi-unsigned.apk');
rmSync(join(APP, 'build'), { recursive: true, force: true });
execFileSync(JAVA, ['-Xmx1g', '-jar', APKTOOL, 'b', APP, '-o', unsigned], { stdio: 'inherit' });

// ── 4. sign (v2) ────────────────────────────────────────────────────────────
step(4, 'signing (APK Signature Scheme v2)…');
if (!existsSync(KEY) || !existsSync(CERT)) {
  execFileSync('node', [join(HERE, 'make-key.mjs'), KEY, CERT],
    { stdio: 'inherit', env: { ...process.env, APKTOOLS_MODULES: MODULES } });
}
mkdirSync(dirname(OUT), { recursive: true });
execFileSync('node', [join(HERE, 'sign.mjs'), unsigned, OUT, KEY, CERT],
  { stdio: 'inherit', env: { ...process.env, APKTOOLS_MODULES: MODULES } });

// ── 5. verify ───────────────────────────────────────────────────────────────
step(5, 'verifying…');
execFileSync('python3', [join(HERE, 'verify.py'), OUT], { stdio: 'inherit' });
if (existsSync(AAPT2)) {
  const badging = execFileSync(AAPT2, ['dump', 'badging', OUT], { encoding: 'utf8' });
  console.log(badging.split('\n').slice(0, 4).join('\n'));
}

const buf = readFileSync(OUT);
console.log(`\n\x1b[1m▶ ${OUT}\x1b[0m`);
console.log(`  size   ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`  sha256 ${createHash('sha256').update(buf).digest('hex')}`);
rmSync(join(APP, 'build'), { recursive: true, force: true });
