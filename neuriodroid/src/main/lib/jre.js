'use strict';
/**
 * Java runtime provisioning.
 *
 * Google's sdkmanager/avdmanager are Java programs (JDK 17+). Instead of asking
 * the user to install Java, NeuroDroid downloads a private Eclipse Temurin JRE
 * into its own folder and uses that — it never touches the system PATH.
 */
const fs = require('fs');
const path = require('path');
const { download } = require('./download');
const { extractZip, singleTopDir, moveContents, rmrf } = require('./zip');
const { run, tryRun, IS_WIN, exists } = require('./proc');

const ADOPTIUM = 'https://api.adoptium.net/v3/binary/latest/{feature}/ga/{os}/{arch}/jre/hotspot/normal/eclipse';
const ADOPTIUM_FALLBACKS = [
  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jre_x64_windows_hotspot_17.0.13_11.zip',
  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.12%2B7/OpenJDK17U-jre_x64_windows_hotspot_17.0.12_7.zip',
];

function jreUrl() {
  const os = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return ADOPTIUM.replace('{feature}', '17').replace('{os}', os).replace('{arch}', arch);
}

/** Look for an already-installed JDK/JRE 17+ on the machine. */
async function findSystemJava() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', IS_WIN ? 'java.exe' : 'java'));
  candidates.push(IS_WIN ? 'java.exe' : 'java');
  if (IS_WIN) {
    for (const base of ['C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Java', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Android\\Android Studio\\jbr']) {
      try {
        const st = fs.statSync(base);
        if (st.isFile() && base.endsWith('jbr')) { candidates.push(path.join(base, 'bin', 'java.exe')); continue; }
        for (const d of fs.readdirSync(base)) candidates.push(path.join(base, d, 'bin', 'java.exe'));
      } catch (_) {}
    }
    candidates.push('C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe');
  }
  for (const java of candidates) {
    const out = await tryRun(java, ['-version'], { timeout: 20000 });
    // java -version writes to stderr
    const r = await run(java, ['-version'], { timeout: 20000 });
    const text = `${r.stdout}\n${r.stderr}`;
    const m = text.match(/version "(\d+)(?:\.(\d+))?/);
    if (out !== null || m) {
      const major = m ? parseInt(m[1], 10) : 0;
      if (major >= 17) {
        const binDir = path.dirname(java);
        const home = path.dirname(binDir);
        return { java, home, version: major, source: 'system' };
      }
    }
  }
  return null;
}

/** Parse "17.0.13" style output of `java -version`. */
function parseJavaVersion(text) {
  const m = String(text).match(/version "(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  const major = parseInt(m[1], 10);
  // Java 8 reports 1.8.x
  return major === 1 ? parseInt(m[2] || '0', 10) : major;
}

/**
 * Ensure a usable Java 17+ runtime.
 * @param {object} paths
 * @param {function} onProgress ({phase,percent,label,detail})
 */
async function ensureJava(paths, onProgress = () => {}, { signal, prefer = 'bundled' } = {}) {
  const report = (o) => onProgress(Object.assign({ component: 'jre' }, o));

  // 1. Already extracted in our folder?
  const javaExe = paths.java;
  if (exists(javaExe)) {
    const r = await run(javaExe, ['-version'], { timeout: 20000 });
    const v = parseJavaVersion(`${r.stdout}${r.stderr}`);
    if (v && v >= 17) {
      report({ phase: 'done', percent: 100, label: `Java ${v} (bundled)` });
      return { java: javaExe, home: paths.jre, version: v, source: 'bundled' };
    }
    report({ phase: 'info', percent: 5, label: 'Re-downloading Java runtime…' });
    rmrf(paths.jre);
  }

  // 2. Reuse an existing Android Studio JBR / system JDK if the user prefers it.
  if (prefer === 'system' || !IS_WIN) {
    const sys = await findSystemJava();
    if (sys) { report({ phase: 'done', percent: 100, label: `Java ${sys.version} (system)` }); return sys; }
  }

  // 3. Download Temurin JRE 17.
  const zip = path.join(paths.downloads, 'temurin-jre-17-win.zip');
  const urls = [jreUrl(), ...ADOPTIUM_FALLBACKS];
  let lastErr = null;
  for (const url of urls) {
    if (signal && signal.aborted) throw new Error('aborted');
    try {
      report({ phase: 'download', percent: 0, label: 'Java runtime (Temurin JRE 17)', detail: url });
      await download({
        url, dest: zip, signal,
        onProgress: (p) => report({
          phase: 'download',
          percent: p.total ? Math.round((p.received / p.total) * 90) : 0,
          received: p.received, total: p.total, speed: p.speed,
          label: 'Java runtime (Temurin JRE 17)',
        }),
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      report({ phase: 'warn', percent: 0, label: `Mirror failed: ${err.message || err}` });
    }
  }
  if (lastErr) throw lastErr;

  report({ phase: 'extract', percent: 92, label: 'Extracting Java runtime…' });
  const stage = path.join(paths.temp, 'jre-stage-' + Date.now());
  rmrf(stage);
  await extractZip(zip, stage, (p) => report({
    phase: 'extract', percent: 92 + Math.round((p.total ? p.done / p.total : 0) * 6), label: 'Extracting Java runtime…',
  }));

  const top = singleTopDir(stage) || stage;
  rmrf(paths.jre);
  fs.mkdirSync(path.dirname(paths.jre), { recursive: true });
  try {
    fs.renameSync(top, paths.jre);
  } catch (_) {
    // Cross-device or locked: fall back to copying entries.
    moveContents(top, paths.jre);
  }
  rmrf(stage);

  if (!exists(paths.java)) throw new Error('Java extraction failed: java executable not found');
  const r = await run(paths.java, ['-version'], { timeout: 20000 });
  const version = parseJavaVersion(`${r.stdout}${r.stderr}`) || 17;
  report({ phase: 'done', percent: 100, label: `Java ${version} ready` });
  return { java: paths.java, home: paths.jre, version, source: 'bundled' };
}

module.exports = { ensureJava, findSystemJava, parseJavaVersion, jreUrl };
