#!/usr/bin/env node
/**
 * Validates the electron-builder configuration in package.json against the schema that
 * ships with the installed electron-builder, so an invalid option is caught here instead
 * of 20 minutes into a Windows CI job.
 *
 *   node tools/check-build-config.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const config = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build;

if (!config) {
  console.error('package.json has no "build" field — nothing to validate.');
  process.exit(1);
}

let schema;
try {
  schema = require(join(root, 'node_modules', 'app-builder-lib', 'scheme.json'));
} catch {
  console.log('electron-builder is not installed — skipping the configuration check.');
  process.exit(0);
}

let ajv;
try {
  const { default: Ajv } = await import(pathToFileURL(require.resolve('ajv')).href);
  ajv = new Ajv({ allErrors: true, strict: false });
} catch {
  console.log('ajv is unavailable — skipping the configuration check.');
  process.exit(0);
}

const validate = ajv.compile(schema);
if (validate(config)) {
  console.log('electron-builder configuration is valid ✔');
  process.exit(0);
}

console.error('electron-builder configuration is INVALID:');
for (const error of validate.errors ?? []) {
  console.error(`  ${error.instancePath || '(root)'}: ${error.message} ${JSON.stringify(error.params)}`);
}
process.exit(1);
