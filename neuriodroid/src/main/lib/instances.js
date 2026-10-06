'use strict';
/**
 * Emulator instance manager — the "LDPlayer multi-instance" part.
 *
 * Each instance is a real `emulator.exe` child process with its own console
 * port, its own log file and its own state machine:
 *   starting → booting → ready → stopping → stopped | error
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { killTree, exists } = require('./proc');
const avd = require('./avd');
const log = require('./logger').scoped('instances');

const STATE = {
  STOPPED: 'stopped', STARTING: 'starting', BOOTING: 'booting',
  READY: 'ready', STOPPING: 'stopping', ERROR: 'error',
};

/** Known emulator failure signatures → friendly, actionable messages. */
const ERROR_SIGNATURES = [
  { re: /x86(_64)? emulation currently requires hardware acceleration/i, id: 'accel', title: 'Hardware acceleration is off', fix: 'accel' },
  { re: /WHPX[:\s].*(failed|error)|Failed to initialize WHPX|WHPX is not installed/i, id: 'whpx', title: 'WHPX could not start', fix: 'accel' },
  { re: /AEHD.*(failed|cannot|not installed)|Failed to open the AEHD device/i, id: 'aehd', title: 'AEHD driver problem', fix: 'accel' },
  { re: /HAXM.*(not installed|failed)/i, id: 'haxm', title: 'HAXM problem', fix: 'accel' },
  { re: /hypervisorlaunchtype|Hyper-V is disabled/i, id: 'hyperv', title: 'Hyper-V launch type disabled', fix: 'accel' },
  { re: /VT-x|VMX|SVM|virtualization.*(disabled|not supported|unavailable)/i, id: 'bios', title: 'CPU virtualization disabled in BIOS', fix: 'bios' },
  { re: /OpenGL.*(failed|error)|wglCreateContext|Failed to create.*context|GL_|gpu.*not supported/i, id: 'gpu', title: 'GPU rendering failed', fix: 'gpu' },
  { re: /No space left on device|not enough (disk )?space|ENOSPC/i, id: 'disk', title: 'Not enough disk space', fix: 'disk' },
  { re: /cannot find AVD system function|AVD.*not found|Unknown AVD name/i, id: 'avd', title: 'AVD not found', fix: 'avd' },
  { re: /system image.*not (found|installed)|Could not find.*system-images/i, id: 'image', title: 'System image missing', fix: 'image' },
  { re: /out of memory|cannot allocate|OOM/i, id: 'ram', title: 'Not enough RAM', fix: 'ram' },
  { re: /Another emulator instance.*already running|port .* (in use|already)/i, id: 'port', title: 'Port busy', fix: 'port' },
];

function classifyError(text) {
  for (const sig of ERROR_SIGNATURES) {
    if (sig.re.test(text)) return { id: sig.id, title: sig.title, fix: sig.fix, matched: String(text).slice(0, 240) };
  }
  return null;
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

class Instances extends EventEmitter {
  constructor(paths, settings, adb) {
    super();
    this.paths = paths;
    this.settings = settings;
    this.adb = adb;
    this.map = new Map(); // key: avdName#port -> instance
  }

  list() { return [...this.map.values()].map((i) => i.public()); }

  get(key) { return this.map.get(key) || null; }
  byAvd(name) { return [...this.map.values()].filter((i) => i.avdName === name); }
  bySerial(serial) { return [...this.map.values()].find((i) => i.serial === serial) || null; }

  async allocPort() {
    const base = this.settings.get().basePort || 5554;
    const used = new Set([...this.map.values()].map((i) => i.port));
    for (let p = base; p < base + 64; p += 2) {
      if (used.has(p) || used.has(p + 1)) continue;
      if (await portFree(p) && await portFree(p + 1)) return p;
    }
    throw new Error('No free emulator port available');
  }

  /** Build the emulator command line. */
  buildArgs(dev, opts = {}) {
    const s = this.settings.get();
    const a = ['-avd', dev.name, '-port', String(opts.port)];

    const gpu = opts.gpu || s.gpu || 'auto';
    if (gpu && gpu !== 'default') a.push('-gpu', gpu);

    const accel = opts.accel || s.accel || 'auto';
    if (accel && accel !== 'default') a.push('-accel', accel);

    if (opts.ramMB || s.ramMB) a.push('-memory', String(opts.ramMB || s.ramMB));
    if (opts.cores || s.cores) a.push('-cores', String(opts.cores || s.cores));

    if (s.noBootAnim !== false && !opts.bootAnim) a.push('-no-boot-anim');
    if (s.metrics === false) a.push('-no-metrics');

    if (opts.snapshot) a.push('-snapshot', opts.snapshot, '-no-snapshot-save');
    else if (opts.coldBoot) a.push('-no-snapshot-load');

    if (opts.wipeData) a.push('-wipe-data');
    if (opts.headless) { a.push('-no-window'); if (!opts.audio) a.push('-no-audio'); }
    else if (opts.audio === false || s.audio === false) a.push('-no-audio');

    if (opts.readOnly) a.push('-read-only');
    if (opts.skin) a.push('-skin', opts.skin);
    if (s.dns) a.push('-dns-server', s.dns);
    a.push('-netdelay', opts.netdelay || 'none', '-netspeed', opts.netspeed || 'full');
    if (opts.timezone) a.push('-timezone', opts.timezone);
    if (opts.httpProxy) a.push('-http-proxy', opts.httpProxy);
    if (opts.verbose) a.push('-verbose');
    if (opts.showKernel) a.push('-show-kernel');
    if (opts.extra && Array.isArray(opts.extra)) a.push(...opts.extra);
    return a;
  }

  /**
   * Start an instance.
   * @param {string} name AVD name
   * @param {object} opts {snapshot, coldBoot, wipeData, headless, gpu, accel, ramMB, cores, readOnly, secondInstance}
   */
  async start(name, opts = {}) {
    const devs = avd.list(this.paths);
    const dev = devs.find((d) => d.name === name);
    if (!dev) throw new Error(`AVD "${name}" not found`);
    if (!exists(this.paths.emulatorBin)) throw new Error('The Android Emulator is not installed yet — run Setup first');
    if (dev.missingImage) throw new Error(`System image for "${name}" is missing (${dev.sysdir}). Install it from Setup.`);

    const already = this.byAvd(name).filter((i) => [STATE.STARTING, STATE.BOOTING, STATE.READY].includes(i.state));
    if (already.length && !opts.readOnly && !opts.secondInstance) {
      return already[0];
    }

    const port = await this.allocPort();
    const serial = `emulator-${port}`;
    const key = `${name}#${port}`;
    const inst = new Instance({
      key, name, displayName: dev.displayName, port, serial, dev,
      paths: this.paths, adb: this.adb, manager: this, opts,
    });
    this.map.set(key, inst);
    this.emit('list', this.list());
    inst.launch();
    return inst;
  }

  async stopAll() {
    await Promise.all([...this.map.values()].map((i) => i.stop().catch(() => {})));
  }

  /** Clean up stale state after a crash. */
  reap() {
    for (const [key, inst] of this.map) {
      if (inst.state === STATE.STOPPED || inst.state === STATE.ERROR) {
        // keep for the UI; it is removed on user action
      }
    }
  }

  forget(key) {
    const inst = this.map.get(key);
    if (!inst) return false;
    inst.dispose();
    this.map.delete(key);
    this.emit('list', this.list());
    return true;
  }
}

class Instance {
  constructor({ key, name, displayName, port, serial, dev, paths, adb, manager, opts }) {
    this.key = key;
    this.avdName = name;
    this.displayName = displayName;
    this.port = port;
    this.serial = serial;
    this.dev = dev;
    this.paths = paths;
    this.adb = adb;
    this.manager = manager;
    this.opts = opts;
    this.state = STATE.STARTING;
    this.child = null;
    this.pid = null;
    this.startedAt = Date.now();
    this.bootedAt = null;
    this.error = null;
    this.errorInfo = null;
    this.logFile = path.join(paths.logs, `instance-${name}-${port}-${Date.now()}.log`);
    this.logStream = null;
    this.ring = [];
    this.record = null;
    this.previewTimer = null;
    this.previewOn = false;
    this.exitCode = null;
  }

  emit(state, extra = {}) {
    this.state = state;
    this.manager.emit('state', Object.assign(this.public(), extra));
  }

  logLine(line) {
    const entry = { t: Date.now(), line };
    this.ring.push(entry);
    if (this.ring.length > 800) this.ring.splice(0, this.ring.length - 800);
    if (this.logStream) { try { this.logStream.write(line + '\n'); } catch (_) {} }
    const err = classifyError(line);
    if (err && !this.errorInfo) this.errorInfo = err;
    this.manager.emit('log', { key: this.key, serial: this.serial, line, error: err || undefined });
  }

  launch() {
    const args = this.manager.buildArgs(this.dev, Object.assign({ port: this.port }, this.opts));
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
    } catch (_) {}
    this.logLine(`$ "${this.paths.emulatorBin}" ${args.join(' ')}`);

    let child;
    try {
      child = spawn(this.paths.emulatorBin, args, {
        env: this.paths.env(),
        cwd: this.paths.emulator,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.fail(`Could not start the emulator: ${err.message || err}`);
      return;
    }
    this.child = child;
    this.pid = child.pid;
    this.emit(STATE.STARTING, { pid: child.pid, args });
    avd.bumpLaunch(this.paths, this.avdName);

    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, i).replace(/\x1b\[[0-9;]*m/g, '');
        buf = buf.slice(i + 1);
        if (line.trim()) this.logLine(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (err) => this.fail(`Emulator process error: ${err.message || err}`));
    child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.adb.dropLive(this.serial);
      this.stopPreview();
      if (this.state === STATE.STOPPING) {
        this.emit(STATE.STOPPED, { code, signal });
      } else {
        const info = this.errorInfo || (code !== 0 ? classifyError(this.ring.map((r) => r.line).join('\n')) : null);
        this.errorInfo = info;
        this.error = info ? info.title : `Emulator exited (code ${code}, signal ${signal || '-'})`;
        this.emit(code === 0 ? STATE.STOPPED : STATE.ERROR, { code, signal, error: this.error, errorInfo: info });
      }
      if (this.logStream) { try { this.logStream.end(); } catch (_) {} this.logStream = null; }
    });

    this.watchBoot();
  }

  fail(message) {
    this.error = message;
    this.logLine('ERROR: ' + message);
    this.emit(STATE.ERROR, { error: message, errorInfo: this.errorInfo });
  }

  async watchBoot() {
    this.emit(STATE.BOOTING);
    const ok = await this.adb.waitForDevice(this.serial, {
      timeoutMs: 8 * 60 * 1000,
      onTick: (s) => { if (s === 'booting') this.manager.emit('state', this.public()); },
    });
    if (!ok) {
      if (this.child && this.child.exitCode == null) {
        this.fail('The device did not finish booting in 8 minutes. Check acceleration (Diagnostics) or lower RAM/cores.');
      }
      return;
    }
    this.bootedAt = Date.now();
    const info = await this.adb.screenInfo(this.serial).catch(() => ({}));
    const model = await this.adb.getprop(this.serial, 'ro.product.model').catch(() => '');
    const release = await this.adb.getprop(this.serial, 'ro.build.version.release').catch(() => '');
    this.emit(STATE.READY, {
      bootSeconds: Math.round((this.bootedAt - this.startedAt) / 1000),
      screen: info, model, release,
    });
    if (this.opts.headless) this.startPreview();
  }

  async stop({ force = false } = {}) {
    if (this.state === STATE.STOPPED) return true;
    this.emit(STATE.STOPPING);
    this.stopPreview();
    if (this.record) { try { this.adb.recordStop(this.record.child); } catch (_) {} this.record = null; }
    if (!force) {
      try { await this.adb.emu(this.serial, 'kill'); } catch (_) {}
      const started = Date.now();
      while (Date.now() - started < 15000 && this.child && this.child.exitCode == null) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (this.child && this.child.exitCode == null) killTree(this.child);
    this.adb.dropLive(this.serial);
    this.emit(STATE.STOPPED);
    return true;
  }

  // --- snapshots -----------------------------------------------------------
  async saveSnapshot(id = `snap_${Date.now()}`) {
    const r = await this.adb.emu(this.serial, `avd snapshot save ${id}`);
    this.logLine(`snapshot save ${id} → code ${r.code}`);
    return { ok: r.code === 0, id, output: r.stdout + r.stderr };
  }

  async loadSnapshot(id) {
    const r = await this.adb.emu(this.serial, `avd snapshot load ${id}`);
    this.logLine(`snapshot load ${id} → code ${r.code}`);
    return { ok: r.code === 0, id, output: r.stdout + r.stderr };
  }

  snapshots() { return avd.snapshots(this.paths, this.avdName); }

  // --- convenience actions -------------------------------------------------
  async screenshot(dest) {
    const file = dest || path.join(this.paths.captures, `${this.avdName}-${Date.now()}.png`);
    return this.adb.screenshot(this.serial, file);
  }

  async startRecord({ seconds = 180 } = {}) {
    if (this.record) return this.record;
    const stamp = `${this.avdName}-${Date.now()}`;
    const devicePath = `/sdcard/Movies/${stamp}.mp4`;
    const localPath = path.join(this.paths.records, `${stamp}.mp4`);
    const child = await this.adb.recordStart(this.serial, devicePath, { seconds });
    this.record = { child, devicePath, localPath, startedAt: Date.now(), seconds };
    this.logLine(`screenrecord started → ${devicePath}`);
    return this.record;
  }

  async stopRecord() {
    if (!this.record) return null;
    const rec = this.record;
    this.record = null;
    await this.adb.recordStop(rec.child);
    await new Promise((r) => setTimeout(r, 1200));
    const pull = await this.adb.pull(this.serial, rec.devicePath, rec.localPath);
    await this.adb.sh(this.serial, `rm -f ${rec.devicePath}`);
    this.logLine(`screenrecord saved → ${rec.localPath} (adb code ${pull.code})`);
    return Object.assign(rec, { ok: pull.code === 0 && fs.existsSync(rec.localPath), pull });
  }

  // --- in-app live preview (screencap polling) ------------------------------
  startPreview() {
    if (this.previewOn) return;
    this.previewOn = true;
    const fps = Math.max(0.5, Math.min(10, this.manager.settings.get().previewFps || 2));
    const tick = async () => {
      if (!this.previewOn) return;
      if (this.state !== STATE.READY) { this.previewTimer = setTimeout(tick, 2000); return; }
      try {
        const file = path.join(this.paths.temp, `preview-${this.key.replace(/[^a-z0-9]/gi, '_')}.png`);
        await this.adb.screenshot(this.serial, file);
        const buf = fs.readFileSync(file);
        this.manager.emit('preview', { key: this.key, serial: this.serial, png: buf.toString('base64'), at: Date.now() });
      } catch (err) {
        this.previewOn = false;
        this.logLine(`preview stopped: ${err.message || err}`);
        return;
      }
      this.previewTimer = setTimeout(tick, Math.round(1000 / fps));
    };
    tick();
  }

  stopPreview() {
    this.previewOn = false;
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
  }

  dispose() {
    this.stopPreview();
    if (this.record) { try { this.adb.recordStop(this.record.child); } catch (_) {} this.record = null; }
    if (this.logStream) { try { this.logStream.end(); } catch (_) {} this.logStream = null; }
    this.manager.removeAllListeners && null;
  }

  public() {
    return {
      key: this.key, avdName: this.avdName, displayName: this.displayName,
      port: this.port, serial: this.serial, state: this.state, pid: this.pid,
      startedAt: this.startedAt, bootedAt: this.bootedAt, exitCode: this.exitCode,
      error: this.error, errorInfo: this.errorInfo, logFile: this.logFile,
      headless: !!this.opts.headless, gpu: this.opts.gpu || this.manager.settings.get().gpu,
      snapshot: this.opts.snapshot || null,
      dev: {
        width: this.dev.width, height: this.dev.height, api: this.dev.api,
        tag: this.dev.tag, abi: this.dev.abi, ramMB: this.dev.ramMB,
        playStore: this.dev.playStore, image: this.dev.image,
      },
      recording: !!this.record,
      preview: this.previewOn,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }
}

module.exports = { Instances, Instance, STATE, classifyError, ERROR_SIGNATURES, portFree };
