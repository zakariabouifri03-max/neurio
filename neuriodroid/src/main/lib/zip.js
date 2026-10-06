'use strict';
/** Zip / tar extraction helpers (pure JS, no native deps). */
const fs = require('fs');
const path = require('path');
const StreamZip = require('node-stream-zip');
const { execFileSync } = require('child_process');

/**
 * Extract a .zip into destDir.
 * @returns {Promise<{entries:number, topDirs:string[]}>}
 */
function extractZip(zipPath, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const zip = new StreamZip.async({ file: zipPath });
    let done = 0;
    zip.entriesCount.then((count) => {
      const timer = setInterval(() => {
        if (onProgress) onProgress({ done, total: count, phase: 'extract' });
      }, 250);
      zip.extract(null, destDir)
        .then((n) => {
          clearInterval(timer);
          done = count;
          if (onProgress) onProgress({ done, total: count, phase: 'extract' });
          return zip.close().then(() => n).catch(() => n);
        })
        .then((n) => {
          let topDirs = [];
          try { topDirs = fs.readdirSync(destDir); } catch (_) {}
          resolve({ entries: n || count, topDirs });
        })
        .catch((e) => { clearInterval(timer); zip.close().catch(() => {}); reject(e); });
    }).catch((e) => { zip.close().catch(() => {}); reject(e); });
  });
}

/**
 * If the zip extracted into a single wrapper folder (as Google's
 * commandlinetools-win-*.zip does: `cmdline-tools/`), return its path.
 */
function singleTopDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) return path.join(dir, entries[0].name);
  return null;
}

/** Extract .tar.gz (AEHD / some releases) using system tar (Windows 10+ ships bsdtar). */
function extractTarGz(tarPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarPath, '-C', destDir], { stdio: 'ignore' });
  return destDir;
}

function moveContents(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  for (const entry of fs.readdirSync(fromDir)) {
    const src = path.join(fromDir, entry);
    const dst = path.join(toDir, entry);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.renameSync(src, dst);
  }
}

function rmrf(target) {
  try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 }); return true; } catch (_) { return false; }
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch (_) {} }
    }
  };
  walk(dir);
  return total;
}

module.exports = { extractZip, singleTopDir, extractTarGz, moveContents, rmrf, dirSize };
