/**
 * scanner-build.mjs - the single implementation of the scanner build.
 *
 * Used by tools/build-scanner.mjs (writes the file) and tools/validate.mjs
 * (verifies it is not stale), so "is it in sync?" can never disagree with
 * "build it".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const repoRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

export const paths = {
  parse: join(repoRoot, 'src/core/parse.js'),
  scannerSrc: join(repoRoot, 'src/content/scanner.src.js'),
  scannerOut: join(repoRoot, 'src/content/scanner.js'),
};

const BANNER = `/* GENERATED FILE - DO NOT EDIT.
 * Sources: src/content/scanner.src.js + src/core/parse.js
 * Rebuild: node tools/build-scanner.mjs
 */`;

/** Render the exact contents of src/content/scanner.js. */
export function renderScanner() {
  const parseSrc = readFileSync(paths.parse, 'utf8');
  const scannerSrc = readFileSync(paths.scannerSrc, 'utf8');

  // ES module syntax → plain declarations so the code can live inside the IIFE,
  // and drop the section separator comments (pure noise once inlined).
  const inlined = parseSrc
    .replace(/^export\s+/gm, '')
    .replace(/\/\* ─[^\n]*\n/g, '')
    .trim();

  if (!scannerSrc.includes('/*__PARSE_JS__*/')) {
    throw new Error('scanner.src.js is missing the /*__PARSE_JS__*/ placeholder');
  }

  return { output: `${BANNER}\n${scannerSrc.replace('/*__PARSE_JS__*/', inlined)}\n`, inlined };
}

/** Self-check that the inlined parsers behave identically to the module versions. */
export function checkInlinedParsers(inlined) {
  const failures = [];
  const api = new Function(`${inlined}\nreturn { parsePrice, parseCount, parseResultCount, median, priceClustering };`)();
  if (api.parsePrice('$14.99') !== 14.99) failures.push('parsePrice');
  if (api.parsePrice('12,50 €') !== 12.5) failures.push('parsePrice (eu)');
  if (api.parseCount('1.2k') !== 1200) failures.push('parseCount');
  if (api.parseCount('1,234') !== 1234) failures.push('parseCount (grouping)');
  if (api.parseResultCount('1-48 of over 2,000 results') !== 2000) failures.push('parseResultCount');
  if (api.median([1, 3, 2]) !== 2) failures.push('median');
  let syntax = null;
  try {
    // The whole generated file must compile (not run): catches a broken inline.
    // eslint-disable-next-line no-new-func
    new Function(`${inlined}\nreturn 1;`);
  } catch (error) {
    syntax = error.message;
  }
  if (syntax) failures.push(`syntax: ${syntax}`);
  return failures;
}
