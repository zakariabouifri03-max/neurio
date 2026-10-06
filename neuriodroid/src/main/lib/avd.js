'use strict';
/**
 * AVD (Android Virtual Device) management.
 *
 * AVDs are created by writing the same two files Android Studio writes:
 *   <avdHome>/<name>.ini           pointer file
 *   <avdHome>/<name>.avd/config.ini device definition
 * This is deterministic (no Java quirks, no locale issues) and we keep a
 * neuriodroid.json sidecar with the friendly metadata we show in the UI.
 */
const fs = require('fs');
const path = require('path');
const { runTool } = require('./bat');
const { exists, dirExists } = require('./proc');
const { rmrf } = require('./zip');
const sdk = require('./sdk');
const log = require('./logger').scoped('avd');

/** Device profiles — tuned for gaming (16:9 / 20:9 phones + tablet + TV). */
const PROFILES = [
  { id: 'phone_6_1', name: 'Neurio Phone 6.1"', width: 1080, height: 2400, density: 440, orientation: 'Portrait', ram: 4096, heap: 512 },
  { id: 'phone_6_7', name: 'Neurio Phone 6.7"', width: 1440, height: 3120, density: 560, orientation: 'Portrait', ram: 6144, heap: 640 },
  { id: 'phone_5_8', name: 'Neurio Compact 5.8"', width: 1080, height: 2280, density: 440, orientation: 'Portrait', ram: 3072, heap: 384 },
  { id: 'phone_game', name: 'Neurio GamePad 6.5"', width: 1080, height: 2340, density: 420, orientation: 'Portrait', ram: 6144, heap: 640 },
  { id: 'tablet_11', name: 'Neurio Tablet 11"', width: 2560, height: 1600, density: 320, orientation: 'Landscape', ram: 6144, heap: 640 },
  { id: 'tv_1080', name: 'Neurio TV 1080p', width: 1920, height: 1080, density: 320, orientation: 'Landscape', ram: 4096, heap: 512 },
  { id: 'custom', name: 'Custom…', width: 1080, height: 1920, density: 420, orientation: 'Portrait', ram: 4096, heap: 512 },
];

function profileById(id) { return PROFILES.find((p) => p.id === id) || PROFILES[0]; }

/** AVD names must match [A-Za-z0-9._-] — sanitise and de-duplicate. */
function sanitizeName(name, taken = []) {
  let n = String(name || 'NeurioPhone').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!n) n = 'NeurioPhone';
  if (/^\d/.test(n)) n = 'A' + n;
  let out = n; let i = 2;
  while (taken.includes(out)) { out = `${n}_${i++}`; }
  return out;
}

function avdDir(paths, name) { return path.join(paths.avdHome, `${name}.avd`); }
function metaFile(paths, name) { return path.join(avdDir(paths, name), 'neuriodroid.json'); }

/** Build the config.ini contents. */
function configIni(cfg, image) {
  const parts = String(image).split(';'); // system-images;android-34;tag;abi
  const api = parts[1] || 'android-34';
  const tag = parts[2] || 'google_apis';
  const abi = parts[3] || 'x86_64';
  const sysdir = `system-images/${api}/${tag}/${abi}/`;
  const playStore = tag === 'google_apis_playstore';

  const lines = [
    `AvdId=${cfg.name}`,
    `PlayStore.enabled=${playStore ? 'true' : 'false'}`,
    `abi.type=${abi}`,
    `avd.ini.displayname=${cfg.displayName || cfg.name}`,
    'avd.ini.encoding=UTF-8',
    `disk.dataPartition.size=${cfg.dataGB || 12}G`,
    'fastboot.forceColdBoot=no',
    'fastboot.forceFastBoot=yes',
    'hw.accelerometer=yes',
    `hw.audioInput=${cfg.mic ? 'yes' : 'no'}`,
    'hw.audioOutput=yes',
    'hw.battery=yes',
    `hw.camera.back=${cfg.cameraBack || 'none'}`,
    `hw.camera.front=${cfg.cameraFront || 'none'}`,
    'hw.cpu.arch=x86_64',
    `hw.cpu.ncore=${cfg.cores || 4}`,
    'hw.dPad=no',
    'hw.device.manufacturer=NeurioDroid',
    `hw.device.name=${cfg.profileId || 'neurio_phone'}`,
    'hw.gps=yes',
    `hw.gpu.enabled=${cfg.gpuEnabled === false ? 'no' : 'yes'}`,
    `hw.gpu.mode=${cfg.gpuMode || 'auto'}`,
    `hw.initialOrientation=${cfg.orientation || 'Portrait'}`,
    'hw.keyboard=yes',
    `hw.lcd.density=${cfg.density || 440}`,
    `hw.lcd.height=${cfg.height || 2400}`,
    `hw.lcd.width=${cfg.width || 1080}`,
    'hw.mainKeys=no',
    `hw.ramSize=${cfg.ramMB || 4096}`,
    'hw.sdCard=no',
    'hw.sensors.orientation=yes',
    'hw.sensors.proximity=yes',
    'hw.trackBall=no',
    `image.sysdir.1=${sysdir}`,
    'runtime.network.latency=none',
    'runtime.network.speed=full',
    'showDeviceFrame=no',
    'skin.dynamic=yes',
    `skin.name=${cfg.width || 1080}x${cfg.height || 2400}`,
    'skin.path=_no_skin',
    `tag.display=${playStore ? 'Google Play' : tag === 'google_apis' ? 'Google APIs' : tag}`,
    `tag.id=${tag}`,
    `target=${api}`,
    `vm.heapSize=${cfg.heapMB || 512}`,
  ];
  if (cfg.dns) lines.push(`runtime.network.dns=${cfg.dns}`);
  return lines.join('\n') + '\n';
}

function parseIni(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * Create an AVD.
 * @param {object} cfg {name, displayName, profileId, width,height,density,orientation,
 *                       ramMB, cores, dataGB, heapMB, gpuMode, image}
 */
function create(paths, cfg) {
  if (!cfg || !cfg.image) throw new Error('Missing system image');
  const taken = list(paths).map((a) => a.name);
  const name = sanitizeName(cfg.name || cfg.displayName || 'NeurioPhone', taken);
  cfg = Object.assign({}, cfg, { name });

  const dir = avdDir(paths, name);
  if (dirExists(dir)) throw new Error(`An AVD named ${name} already exists`);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, 'config.ini'), configIni(cfg, cfg.image), 'utf8');

  const ini = [
    'avd.ini.encoding=UTF-8',
    `path=${dir}`,
    `path.rel=avd/${name}.avd`,
    `target=${String(cfg.image).split(';')[1] || 'android-34'}`,
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(paths.avdHome, `${name}.ini`), ini, 'utf8');

  const meta = {
    name,
    displayName: cfg.displayName || name,
    profileId: cfg.profileId || 'custom',
    image: cfg.image,
    api: parseInt(String(cfg.image).split(';')[1]?.replace('android-', '') || '0', 10),
    tag: String(cfg.image).split(';')[2] || '',
    abi: String(cfg.image).split(';')[3] || 'x86_64',
    width: cfg.width, height: cfg.height, density: cfg.density,
    ramMB: cfg.ramMB, cores: cfg.cores, dataGB: cfg.dataGB,
    gpuMode: cfg.gpuMode || 'auto',
    createdAt: Date.now(),
    launches: 0,
    notes: cfg.notes || '',
  };
  fs.writeFileSync(metaFile(paths, name), JSON.stringify(meta, null, 2), 'utf8');
  log.info('created AVD', { name, image: cfg.image });
  return meta;
}

function readMeta(paths, name) {
  try { return JSON.parse(fs.readFileSync(metaFile(paths, name), 'utf8')); } catch (_) { return null; }
}

function update(paths, name, patch) {
  const dir = avdDir(paths, name);
  if (!dirExists(dir)) throw new Error(`No such AVD: ${name}`);
  const cfgPath = path.join(dir, 'config.ini');
  const cfg = parseIni(fs.readFileSync(cfgPath, 'utf8'));
  const meta = readMeta(paths, name) || { name };

  const apply = (k, v) => { cfg[k] = String(v); };
  if (patch.ramMB) { apply('hw.ramSize', patch.ramMB); meta.ramMB = patch.ramMB; }
  if (patch.cores) { apply('hw.cpu.ncore', patch.cores); meta.cores = patch.cores; }
  if (patch.dataGB) { apply('disk.dataPartition.size', `${patch.dataGB}G`); meta.dataGB = patch.dataGB; }
  if (patch.heapMB) apply('vm.heapSize', patch.heapMB);
  if (patch.width && patch.height) {
    apply('hw.lcd.width', patch.width); apply('hw.lcd.height', patch.height);
    apply('skin.name', `${patch.width}x${patch.height}`);
    meta.width = patch.width; meta.height = patch.height;
  }
  if (patch.density) { apply('hw.lcd.density', patch.density); meta.density = patch.density; }
  if (patch.orientation) apply('hw.initialOrientation', patch.orientation);
  if (patch.gpuMode) { apply('hw.gpu.mode', patch.gpuMode); meta.gpuMode = patch.gpuMode; }
  if (patch.displayName) { apply('avd.ini.displayname', patch.displayName); meta.displayName = patch.displayName; }
  if (patch.gpuEnabled !== undefined) apply('hw.gpu.enabled', patch.gpuEnabled ? 'yes' : 'no');

  fs.writeFileSync(cfgPath, Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(metaFile(paths, name), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

function remove(paths, name) {
  const dir = avdDir(paths, name);
  rmrf(dir);
  try { fs.rmSync(path.join(paths.avdHome, `${name}.ini`), { force: true }); } catch (_) {}
  log.info('removed AVD', { name });
  return true;
}

function wipeData(paths, name) {
  const dir = avdDir(paths, name);
  for (const f of ['userdata-qemu.img', 'userdata-qemu.img.qcow2', 'cache.img', 'cache.img.qcow2',
    'userdata.img', 'encryptionkey.img', 'verifiedbootstate-preverified.qemu.vbstate', 'userdata.img.lock']) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) {}
  }
  return true;
}

function snapshots(paths, name) {
  const dir = path.join(avdDir(paths, name), 'snapshots');
  if (!dirExists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const p = path.join(dir, d.name);
      let info = {};
      try { info = parseIni(fs.readFileSync(path.join(p, 'snapshot.ini'), 'utf8')); } catch (_) {}
      let mtime = 0; let bytes = 0;
      try { const st = fs.statSync(p); mtime = st.mtimeMs; } catch (_) {}
      try { bytes = fs.readdirSync(p).reduce((a, f) => { try { return a + fs.statSync(path.join(p, f)).size; } catch (_) { return a; } }, 0); } catch (_) {}
      return { id: d.name, name: info['snapshot.name'] || d.name, mtime, bytes, quickboot: d.name === 'default_boot' };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function deleteSnapshot(paths, name, snapshotId) {
  const dir = path.join(avdDir(paths, name), 'snapshots', snapshotId);
  return rmrf(dir);
}

/** List all AVDs with metadata + on-disk size. */
function list(paths) {
  const out = [];
  if (!dirExists(paths.avdHome)) return out;
  for (const entry of fs.readdirSync(paths.avdHome, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.avd')) continue;
    const name = entry.name.slice(0, -4);
    const dir = path.join(paths.avdHome, entry.name);
    let cfg = {};
    try { cfg = parseIni(fs.readFileSync(path.join(dir, 'config.ini'), 'utf8')); } catch (_) { continue; }
    const meta = readMeta(paths, name) || {};
    out.push({
      name,
      displayName: cfg['avd.ini.displayname'] || meta.displayName || name,
      profileId: meta.profileId || 'custom',
      image: meta.image || `system-images;${cfg.target || 'android-34'};${cfg['tag.id'] || 'google_apis'};${cfg['abi.type'] || 'x86_64'}`,
      api: meta.api || parseInt(String(cfg.target || '').replace('android-', ''), 10) || 0,
      tag: meta.tag || cfg['tag.id'] || '',
      abi: meta.abi || cfg['abi.type'] || 'x86_64',
      width: parseInt(cfg['hw.lcd.width'], 10) || 1080,
      height: parseInt(cfg['hw.lcd.height'], 10) || 2400,
      density: parseInt(cfg['hw.lcd.density'], 10) || 440,
      ramMB: parseInt(cfg['hw.ramSize'], 10) || 4096,
      cores: parseInt(cfg['hw.cpu.ncore'], 10) || 4,
      dataGB: parseInt(String(cfg['disk.dataPartition.size'] || '12G'), 10) || 12,
      gpuMode: cfg['hw.gpu.mode'] || 'auto',
      playStore: String(cfg['PlayStore.enabled']) === 'true' || cfg['tag.id'] === 'google_apis_playstore',
      sysdir: cfg['image.sysdir.1'] || '',
      createdAt: meta.createdAt || 0,
      launches: meta.launches || 0,
      notes: meta.notes || '',
      dir,
      missingImage: !!cfg['image.sysdir.1'] && !dirExists(path.join(paths.sdk, cfg['image.sysdir.1'])),
      snapshotCount: snapshots(paths, name).length,
    });
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function get(paths, name) { return list(paths).find((a) => a.name === name) || null; }

function bumpLaunch(paths, name) {
  const meta = readMeta(paths, name) || { name };
  meta.launches = (meta.launches || 0) + 1;
  meta.lastLaunch = Date.now();
  try { fs.writeFileSync(metaFile(paths, name), JSON.stringify(meta, null, 2), 'utf8'); } catch (_) {}
}

/** Duplicate an AVD (fast: copy config + metadata, no userdata). */
function clone(paths, name, newName) {
  const src = avdDir(paths, name);
  if (!dirExists(src)) throw new Error(`No such AVD: ${name}`);
  const cfg = parseIni(fs.readFileSync(path.join(src, 'config.ini'), 'utf8'));
  const meta = readMeta(paths, name) || {};
  return create(paths, Object.assign({}, meta, cfg, {
    name: newName,
    displayName: (meta.displayName || name) + ' (copy)',
    image: meta.image || cfg.image,
    ramMB: parseInt(cfg['hw.ramSize'], 10),
    cores: parseInt(cfg['hw.cpu.ncore'], 10),
    width: parseInt(cfg['hw.lcd.width'], 10),
    height: parseInt(cfg['hw.lcd.height'], 10),
    density: parseInt(cfg['hw.lcd.density'], 10),
    dataGB: parseInt(String(cfg['disk.dataPartition.size'] || '12G'), 10),
    heapMB: parseInt(cfg['vm.heapSize'], 10),
    gpuMode: cfg['hw.gpu.mode'],
    profileId: meta.profileId,
  }));
}

/** Ask avdmanager to validate our hand-written AVD (optional sanity check). */
async function validateWithAvdmanager(paths) {
  const r = await runTool(Object.assign(sdk.sdkToolSpec(paths, 'avdmanager', ['list', 'avd', '-c']), { timeout: 60000 }));
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}

module.exports = {
  PROFILES, profileById, sanitizeName, create, update, remove, list, get,
  wipeData, snapshots, deleteSnapshot, clone, configIni, parseIni, avdDir,
  bumpLaunch, validateWithAvdmanager,
};
