#!/usr/bin/env node
/**
 * Bundles the Electron main process, the preload bridge and the standalone
 * server into `dist-electron/`, using esbuild.
 *
 *   node tools/build-electron.mjs            # all three targets
 *   node tools/build-electron.mjs --watch    # rebuild on change
 *
 * Layout produced (matches the paths used by electron/main.ts):
 *   dist-electron/electron/main.cjs     Electron main process
 *   dist-electron/electron/preload.cjs  contextBridge preload
 *   dist-electron/server/index.cjs      the Neurio HTTP + WebSocket server
 */
import { build, context } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist-electron');
const watch = process.argv.includes('--watch');

/** Node builtins + the packages Electron/ws provide at runtime. */
const serverExternal = ['bufferutil', 'utf-8-validate', 'electron'];

const targets = [
  {
    name: 'electron/main',
    entryPoints: [join(root, 'electron', 'main.ts')],
    outfile: join(outdir, 'electron', 'main.cjs'),
    platform: 'node',
    external: ['electron'],
    // The main process needs a real CommonJS `__dirname`; nothing else does.
    banner: { js: "'use strict';" },
  },
  {
    name: 'electron/preload',
    entryPoints: [join(root, 'electron', 'preload.ts')],
    outfile: join(outdir, 'electron', 'preload.cjs'),
    platform: 'node',
    external: ['electron'],
  },
  {
    name: 'server',
    entryPoints: [join(root, 'server', 'index.ts')],
    outfile: join(outdir, 'server', 'index.cjs'),
    platform: 'node',
    external: serverExternal,
  },
];

mkdirSync(join(outdir, 'electron'), { recursive: true });
mkdirSync(join(outdir, 'server'), { recursive: true });

const shared = {
  bundle: true,
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
};

if (watch) {
  const contexts = await Promise.all(
    targets.map((target) =>
      context({ ...shared, entryPoints: target.entryPoints, outfile: target.outfile, platform: target.platform, external: target.external }),
    ),
  );
  await Promise.all(contexts.map((builder) => builder.watch()));
  console.log('watching dist-electron/ — press Ctrl+C to stop');
} else {
  for (const target of targets) {
    await build({
      ...shared,
      entryPoints: target.entryPoints,
      outfile: target.outfile,
      platform: target.platform,
      external: target.external,
    });
    console.log(`  ✓ ${target.name} → ${target.outfile.replace(`${root}/`, '')}`);
  }
  console.log('electron bundles written to dist-electron/');
}
