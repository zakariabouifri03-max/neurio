'use strict';
/**
 * Android SDK provisioning + package management.
 *
 * Components (all installed inside our private root, never system-wide):
 *   jre           Eclipse Temurin JRE 17          (~45 MB)
 *   cmdline-tools sdkmanager / avdmanager         (~150 MB)
 *   platform-tools adb, fastboot                  (~8 MB)
 *   emulator      the QEMU-based Android Emulator (~400 MB)
 *   platforms;android-NN   needed to create an AVD for that API
 *   system image  the actual Android OS           (~1.2–1.8 GB)
 */
const fs = require('fs');
const path = require('path');
const { runTool, spawnTool } = require('./bat');
const { download } = require('./download');
const { extractZip, singleTopDir, moveContents, rmrf, dirSize } = require('./zip');
const { exists, dirExists } = require('./proc');
const remote = require('./remote');
const log = require('./logger').scoped('sdk');

/** Google's public SDK licence hashes — writing them avoids interactive prompts. */
const LICENSES = {
  'android-sdk-license': [
    '24333f8a63b6825ea9c5514f83c2829b004d1fee',
    '8933bad161af4178b1185d1a37fbf41ea5269c55',
    'd56f5187479451eabf01fb78af6dfcb131a6481e',
  ],
  'android-sdk-preview-license': ['84831b9409646a918e30573bab4c9c91346d8abd'],
  'android-sdk-arm-dbt-license': ['859f317696f67ef3d7f320ef9dff4ae5c47d97a'],
  'android-googletv-license': ['601085b94cd77f0b54ff86406957099ebe79c4d6'],
  'google-gdk-license': ['33b6a2b64607f11b759f320ef9dff4ae5c47d97a'],
  'mips-android-sysimage-license': ['e9acab5b5fbb560a72797e95bdf3b79b1e6d1e5f'],
  'android-intel-atom-license': ['d975f751698a77e662f1cd748a3e6214bff89f2f'],
};

function acceptLicenses(paths) {
  const dir = path.join(paths.sdk, 'licenses');
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, hashes] of Object.entries(LICENSES)) {
      fs.writeFileSync(path.join(dir, name), '\n' + hashes.map((h) => h).join('\n') + '\n', 'utf8');
    }
    return true;
  } catch (err) {
    log.warn('acceptLicenses failed', { err: String(err.message || err) });
    return false;
  }
}

/** What do we already have on disk? */
function status(paths, settings) {
  const st = {
    java: exists(paths.java),
    cmdlineTools: exists(paths.sdkmanager),
    platformTools: exists(paths.adb),
    emulator: exists(paths.emulatorBin),
    images: [],
    platforms: [],
    sdkBytes: 0,
    root: paths.root,
  };
  if (dirExists(paths.sdk)) {
    try { st.sdkBytes = dirSize(paths.sdk); } catch (_) {}
    const sysRoot = path.join(paths.sdk, 'system-images');
    if (dirExists(sysRoot)) {
      for (const api of fs.readdirSync(sysRoot)) {
        const apiDir = path.join(sysRoot, api);
        if (!dirExists(apiDir)) continue;
        for (const tag of fs.readdirSync(apiDir)) {
          const tagDir = path.join(apiDir, tag);
          if (!dirExists(tagDir)) continue;
          for (const abi of fs.readdirSync(tagDir)) {
            const abiDir = path.join(tagDir, abi);
            if (!dirExists(abiDir)) continue;
            const ok = exists(path.join(abiDir, 'system.img')) || exists(path.join(abiDir, 'advancedFeatures.ini'))
              || fs.readdirSync(abiDir).length > 3;
            if (ok) st.images.push({ api, tag, abi, path: `system-images;${api};${tag};${abi}`, dir: abiDir });
          }
        }
      }
    }
    const platRoot = path.join(paths.sdk, 'platforms');
    if (dirExists(platRoot)) st.platforms = fs.readdirSync(platRoot).filter((d) => d.startsWith('android-'));
  }
  return st;
}

function sdkToolSpec(paths, tool, args) {
  const isWin = process.platform === 'win32';
  const base = {
    env: paths.env(),
    cwd: paths.sdk,
  };
  if (tool === 'sdkmanager') {
    return Object.assign(base, {
      bat: paths.sdkmanager,
      exe: isWin ? null : paths.sdkmanager,
      java: paths.java,
      classpathJar: path.join(paths.cmdlineTools, 'lib', 'classpaths', 'sdkmanager-classpath.jar'),
      mainClass: 'com.android.sdklib.tool.sdkmanager.SdkManagerCli',
      toolsDir: paths.cmdlineTools,
      args: ['--sdk_root=' + paths.sdk, ...args],
    });
  }
  return Object.assign(base, {
    bat: paths.avdmanager,
    exe: isWin ? null : paths.avdmanager,
    java: paths.java,
    classpathJar: path.join(paths.cmdlineTools, 'lib', 'classpaths', 'avdmanager-classpath.jar'),
    mainClass: 'com.android.sdkmanager.AvdManagerCli',
    toolsDir: paths.cmdlineTools,
    args,
  });
}

/**
 * Install cmdline-tools by direct download (fast, no Java needed yet).
 * Handles Google's wrapper folder (zip contains `cmdline-tools/`).
 */
async function installCmdlineTools(paths, archive, onProgress = () => {}, { signal } = {}) {
  const report = (o) => onProgress(Object.assign({ component: 'cmdline-tools' }, o));
  const zip = path.join(paths.downloads, path.basename(new URL(archive.url).pathname));
  report({ phase: 'download', percent: 0, label: 'SDK command-line tools' });
  await download({
    url: archive.url, dest: zip, size: archive.size, sha256: null, signal,
    onProgress: (p) => report({
      phase: 'download', percent: p.total ? Math.round((p.received / p.total) * 85) : 0,
      received: p.received, total: p.total, speed: p.speed, label: 'SDK command-line tools',
    }),
  });
  report({ phase: 'extract', percent: 88, label: 'Extracting command-line tools…' });
  const stage = path.join(paths.temp, 'cmdline-stage-' + Date.now());
  rmrf(stage);
  await extractZip(zip, stage, (p) => report({
    phase: 'extract', percent: 88 + Math.round((p.total ? p.done / p.total : 0) * 10), label: 'Extracting command-line tools…',
  }));
  // zip layout: cmdline-tools/{bin,lib,NOTICE.txt,source.properties}
  const inner = path.join(stage, 'cmdline-tools');
  const src = dirExists(inner) ? inner : (singleTopDir(stage) || stage);
  rmrf(paths.cmdlineTools);
  fs.mkdirSync(path.dirname(paths.cmdlineTools), { recursive: true });
  try { fs.renameSync(src, paths.cmdlineTools); } catch (_) { moveContents(src, paths.cmdlineTools); }
  rmrf(stage);
  if (!exists(paths.sdkmanager)) throw new Error('cmdline-tools extraction failed (sdkmanager not found)');
  acceptLicenses(paths);
  report({ phase: 'done', percent: 100, label: 'Command-line tools ready' });
  return true;
}

/**
 * Install packages through sdkmanager, streaming a normalised progress object.
 * sdkmanager prints bars like:  [==      ] 12% Unzipping...  /  Downloading...
 */
function installPackages(paths, packages, onProgress = () => {}, { signal, autoYes = true } = {}) {
  return new Promise((resolve, reject) => {
    acceptLicenses(paths);
    const args = ['--verbose', '--install', ...packages];
    const report = (o) => onProgress(Object.assign({ component: 'packages' }, o));
    report({ phase: 'start', percent: 0, label: packages.join(', ') });

    let currentFile = '';
    let lastPct = 0;
    let buffer = '';
    let killed = false;

    const child = spawnTool(Object.assign(sdkToolSpec(paths, 'sdkmanager', args), {
      onStdout: (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.search(/[\r\n]/)) >= 0) {
          const raw = buffer.slice(0, idx);
          const nl = buffer[idx];
          buffer = buffer.slice(idx + 1);
          handleLine(raw, nl === '\r');
        }
      },
      onStderr: (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.search(/[\r\n]/)) >= 0) {
          const raw = buffer.slice(0, idx); const nl = buffer[idx]; buffer = buffer.slice(idx + 1);
          handleLine(raw, nl === '\r');
        }
      },
      onExit: (code, err, cap) => {
        if (killed) return reject(new Error('aborted'));
        if (code === 0) { report({ phase: 'done', percent: 100, label: 'Installed' }); return resolve({ code, stdout: cap && cap.stdout, stderr: cap && cap.stderr }); }
        const msg = ((cap && cap.stderr) || (cap && cap.stdout) || '').split('\n').filter(Boolean).slice(-6).join('\n');
        reject(new Error(`sdkmanager exited with ${code}\n${msg}`));
      },
    }));

    if (!child) return reject(new Error('sdkmanager not available — install the command-line tools first'));

    function handleLine(line, isCR) {
      const l = line.trim();
      if (!l) return;
      log.debug('sdkmanager', l.slice(0, 240));
      const bar = l.match(/^\[[^\]]*\]\s*(\d+)%\s*(.*)$/);
      if (bar) {
        const pct = parseInt(bar[1], 10);
        const what = bar[2].trim();
        const fileMatch = what.match(/(?:Downloading|Unzipping|Installing)\s+(.*)$/i);
        if (fileMatch) currentFile = fileMatch[1].trim();
        lastPct = pct;
        report({ phase: pct >= 100 ? 'finalize' : 'download', percent: pct, label: currentFile || what || 'Working…', detail: l });
        return;
      }
      if (/^(Fetching|Parsing|Installing|Unzipping|Downloading|Preparing|done\b)/i.test(l)) {
        report({ phase: 'info', percent: lastPct, label: l.slice(0, 120) });
      }
      if (/accept/i.test(l) && autoYes) {
        try { child.stdin.write('y\n'); } catch (_) {}
      }
    }

    // Pre-emptively answer licence prompts (some builds print without "accept").
    if (autoYes) {
      const t = setInterval(() => { try { if (!killed) child.stdin.write('y\n'); } catch (_) { clearInterval(t); } }, 2500);
      child.on('close', () => clearInterval(t));
    }

    if (signal) {
      const abort = () => {
        killed = true;
        try { child.kill('SIGKILL'); } catch (_) {}
        reject(new Error('aborted'));
      };
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}

/** Parse `sdkmanager --list` (used as a fallback / to show what's installed). */
function parseSdkList(output) {
  const installed = []; const available = [];
  let section = null;
  for (const raw of String(output).split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    if (/^Installed packages:/i.test(line)) { section = 'installed'; continue; }
    if (/^Available Packages:/i.test(line)) { section = 'available'; continue; }
    if (/^Available Updates:/i.test(line)) { section = null; continue; }
    const m = line.match(/^\s{2,}(\S+)\s+(\S.*?)\s+(\d+[^\s]*)\s*$/) || line.match(/^\s*(\S+;[^\s]+|\S+)\s{2,}(.+?)\s{2,}([\d.]+)\s*$/);
    if (!m || !section) continue;
    const entry = { path: m[1].trim(), description: m[2].trim(), version: m[3].trim() };
    (section === 'installed' ? installed : available).push(entry);
  }
  return { installed, available };
}

/** Convert a `system-images;android-34;google_apis_playstore;x86_64` path to its folder. */
function imageDir(paths, pkg) {
  const parts = String(pkg).replace(/^sys-img;/, '').split(';');
  if (parts[0] === 'system-images') parts.shift();
  return path.join(paths.sdk, 'system-images', ...parts);
}

function platformPkgForImage(imagePkg) {
  const parts = String(imagePkg).split(';');
  const api = parts.find((p) => p.startsWith('android-'));
  return api ? `platforms;${api}` : null;
}

/**
 * Full "make me a gaming phone" setup:
 *   java -> cmdline-tools -> platform-tools + emulator + platform + system image
 */
async function provision(paths, settings, { onProgress = () => {}, signal, image, abi = 'x86_64', discovery } = {}) {
  const report = (o) => onProgress(o);
  const steps = [];

  // 0. discovery (may be cached)
  report({ phase: 'discover', percent: 1, label: 'Reading Google repository…' });
  let meta = discovery || await remote.discover({ cacheFile: paths.imagesCache, log, signal });
  if (!meta || !meta.ok) meta = await remote.discover({ cacheFile: paths.imagesCache, log, signal, force: true });
  steps.push({ id: 'discover', ok: !!meta.sdk });

  // 1. Java
  const jre = require('./jre');
  report({ phase: 'component', component: 'jre', percent: 2, label: 'Java runtime' });
  await jre.ensureJava(paths, (p) => report(Object.assign({ component: 'jre' }, p, { percent: 2 + Math.round((p.percent || 0) * 0.08) })), { signal });
  steps.push({ id: 'jre', ok: true });

  // 2. cmdline-tools
  if (!exists(paths.sdkmanager)) {
    const ct = (meta.sdk.cmdlineTools || [])[0];
    if (!ct) throw new Error('No cmdline-tools archive found — check your connection');
    report({ phase: 'component', component: 'cmdline-tools', percent: 11, label: 'SDK command-line tools' });
    await installCmdlineTools(paths, ct.archive, (p) => report(Object.assign({}, p, { percent: 11 + Math.round((p.percent || 0) * 0.09) })), { signal });
  } else {
    report({ phase: 'skip', component: 'cmdline-tools', percent: 20, label: 'Command-line tools already installed' });
  }
  steps.push({ id: 'cmdline-tools', ok: exists(paths.sdkmanager) });
  acceptLicenses(paths);

  // 3. choose image
  const isPotato = settings.profile === 'potato';
  const chosen = image || remote.recommendImage(meta.images, {
    abi,
    // Older Play images are smaller and boot faster on weak machines.
    maxApi: settings.maxApi || (isPotato ? 30 : 35),
    minApi: isPotato ? 28 : 28,
  });
  const imagePkg = chosen ? chosen.package : `system-images;android-34;google_apis_playstore;${abi}`;
  const plat = platformPkgForImage(imagePkg) || 'platforms;android-34';

  // 4. platform-tools + emulator + platform + image
  const st = status(paths, settings);
  const wanted = [];
  if (!st.platformTools) wanted.push('platform-tools');
  if (!st.emulator) wanted.push('emulator');
  if (!st.platforms.includes(plat.split(';')[1])) wanted.push(plat);
  if (!st.images.some((i) => i.path === imagePkg)) wanted.push(imagePkg);

  if (wanted.length) {
    report({ phase: 'component', component: 'packages', percent: 22, label: wanted.join(', ') });
    // Sizes are known from discovery when available: use them for a nicer bar.
    let done = 0;
    await installPackages(paths, wanted, (p) => {
      const span = 76; // 22% -> 98%
      report(Object.assign({}, p, { percent: 22 + Math.round(((p.percent || 0) / 100) * span), packages: wanted, packageIndex: done }));
    }, { signal });
    done = wanted.length;
  } else {
    report({ phase: 'skip', component: 'packages', percent: 98, label: 'All components already installed' });
  }
  steps.push({ id: 'packages', ok: true });

  report({ phase: 'done', percent: 100, label: 'Setup complete', image: imagePkg });
  return { steps, image: imagePkg, imageInfo: chosen, meta };
}

module.exports = {
  status, provision, installCmdlineTools, installPackages, acceptLicenses,
  parseSdkList, imageDir, platformPkgForImage, sdkToolSpec, LICENSES,
};
