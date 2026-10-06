#!/usr/bin/env node
/**
 * build-scanner.mjs - generates src/content/scanner.js from scanner.src.js by
 * inlining the shared parser module (src/core/parse.js).
 *
 * Why: a content script cannot `import` ES modules without listing every file in
 * the manifest, and hand-copying the parsing rules would guarantee drift between
 * the scanner and the engine. One source of truth, one build step.
 *
 * Run: node tools/build-scanner.mjs
 * Self-checks: the inlined parsers behave, and the file compiles.
 */

import { writeFileSync } from 'node:fs';
import { renderScanner, checkInlinedParsers, paths } from './lib/scanner-build.mjs';

const { output, inlined } = renderScanner();
const failures = checkInlinedParsers(inlined);

if (failures.length) {
  console.error(`✗ scanner build self-check failed: ${failures.join(', ')}`);
  process.exit(1);
}

writeFileSync(paths.scannerOut, output);
console.log(`✓ src/content/scanner.js written (${(output.length / 1024).toFixed(1)} KB) - parser + syntax self-check passed`);
