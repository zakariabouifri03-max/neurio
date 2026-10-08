#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const errors = [];
const warnings = [];

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => {
  warnings.push(msg);
  console.log(`  ⚠ ${msg}`);
};
const fail = (msg) => {
  errors.push(msg);
  console.log(`  ✗ ${msg}`);
};

console.log("ANIMAI STUDIO — environment check\n");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 18) ok(`Node.js ${process.version}`);
else fail(`Node.js 18+ required (found ${process.version})`);

const required = ["vite", "jszip", "typescript"];
const optional = ["electron", "electron-builder"];

for (const name of required) {
  const range = pkg.dependencies?.[name] || pkg.devDependencies?.[name] || "*";
  try {
    require.resolve(name, { paths: [root] });
    ok(`${name} (${range})`);
  } catch {
    fail(`Missing package: ${name}. Run npm install`);
  }
}

for (const name of optional) {
  const range = pkg.devDependencies?.[name] || "*";
  try {
    require.resolve(name, { paths: [root] });
    ok(`${name} (${range})`);
  } catch {
    warn(`${name} not installed — desktop packaging unavailable until npm install`);
  }
}

const icon = path.join(root, "assets", "icon.png");
if (fs.existsSync(icon)) ok("App icon present");
else warn("assets/icon.png missing");

try {
  const { execSync } = await import("node:child_process");
  execSync("ffmpeg -version", { stdio: "ignore" });
  ok("ffmpeg available (optional)");
} catch {
  warn("ffmpeg not on PATH — MP4 uses the built-in MediaRecorder encoder");
}

if (errors.length) {
  console.log(`\nCheck failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`\nCheck passed${warnings.length ? ` with ${warnings.length} warning(s)` : ""}.\n`);
