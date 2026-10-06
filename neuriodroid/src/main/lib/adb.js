'use strict';
/**
 * ADB wrapper — everything the UI can do to a running device.
 * All calls are per-serial so multiple emulator instances work side by side.
 */
const path = require('path');
const fs = require('fs');
const { run, tryRun, LiveShell, killTree, IS_WIN } = require('./proc');
const log = require('./logger').scoped('adb');

class Adb {
  constructor(paths) {
    this.paths = paths;
    this.bin = paths.adb;
    this.env = paths.env();
    this.shells = new Map(); // serial -> LiveShell
    this.serverUp = false;
  }

  get ok() { return fs.existsSync(this.bin); }

  async cmd(args, opts = {}) {
    if (!this.ok) throw new Error('adb not installed yet');
    return run(this.bin, args, Object.assign({ env: this.env, timeout: 120000 }, opts));
  }

  async sh(serial, shellCmd, opts) { return this.cmd(['-s', serial, 'shell', shellCmd], opts); }

  async startServer() {
    const r = await this.cmd(['start-server'], { timeout: 60000 });
    this.serverUp = r.code === 0;
    return r;
  }

  async killServer() { return this.cmd(['kill-server'], { timeout: 30000 }); }

  /** Parse `adb devices -l`. */
  async devices() {
    const out = await tryRun(this.bin, ['devices', '-l'], { env: this.env, timeout: 30000 });
    if (out == null) return [];
    const list = [];
    for (const line of out.split(/\r?\n/).slice(1)) {
      const m = line.match(/^(\S+)\s+(device|offline|unauthorized|authorizing|bootloader|recovery|sideload)\s*(.*)$/);
      if (!m) continue;
      const props = {};
      for (const kv of m[3].split(/\s+/)) {
        const i = kv.indexOf(':');
        if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
      }
      list.push({
        serial: m[1], state: m[2],
        model: props.model || '', product: props.product || '', device: props.device || '',
        transport_id: props.transport_id || '', usb: props.usb || '',
        isEmulator: /^emulator-/.test(m[1]) || props.model === 'Android_SDK_built_for_x86' || /sdk_gphone|emulator/i.test(props.product || ''),
      });
    }
    return list;
  }

  async getprop(serial, prop) {
    const out = await tryRun(this.bin, ['-s', serial, 'shell', 'getprop', prop], { env: this.env, timeout: 20000 });
    return out == null ? '' : out.trim();
  }

  async bootCompleted(serial) {
    const v = await this.getprop(serial, 'sys.boot_completed');
    return v === '1';
  }

  async waitForDevice(serial, { timeoutMs = 300000, onTick } = {}) {
    const start = Date.now();
    let lastState = '';
    while (Date.now() - start < timeoutMs) {
      const devs = await this.devices();
      const d = devs.find((x) => x.serial === serial);
      const state = d ? d.state : 'absent';
      if (state !== lastState) { lastState = state; if (onTick) onTick(state); }
      if (state === 'device') {
        const booted = await this.bootCompleted(serial);
        if (booted) return true;
        if (onTick) onTick('booting');
      }
      await sleep(1200);
    }
    return false;
  }

  async screenInfo(serial) {
    const out = await tryRun(this.bin, ['-s', serial, 'shell', 'wm', 'size'], { env: this.env, timeout: 20000 });
    const m = out && out.match(/(\d+)x(\d+)/g);
    const size = m && m.length ? m[m.length - 1] : null; // override comes last
    if (!size) return { width: 0, height: 0, density: 0 };
    const [w, h] = size.split('x').map((n) => parseInt(n, 10));
    const dOut = await tryRun(this.bin, ['-s', serial, 'shell', 'wm', 'density'], { env: this.env, timeout: 20000 });
    const dm = dOut && dOut.match(/(\d+)/g);
    return { width: w, height: h, density: dm && dm.length ? parseInt(dm[dm.length - 1], 10) : 0 };
  }

  /** PNG screenshot straight to disk (binary-safe: we spawn, not execFile). */
  async screenshot(serial, destPng) {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const child = spawn(this.bin, ['-s', serial, 'exec-out', 'screencap', '-p'], { env: this.env, windowsHide: true });
      const chunks = [];
      let err = '';
      child.stdout.on('data', (d) => chunks.push(d));
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`screencap failed (${code}) ${err}`));
        const buf = Buffer.concat(chunks);
        if (!buf.length) return reject(new Error('empty screenshot'));
        fs.mkdirSync(path.dirname(destPng), { recursive: true });
        fs.writeFileSync(destPng, buf);
        resolve(destPng);
      });
    });
  }

  async recordStart(serial, devicePath, { seconds = 180, bitrate = '8M' } = {}) {
    // Fire and forget: the shell keeps running until the limit is hit or we kill it.
    const { spawn } = require('child_process');
    const child = spawn(this.bin, ['-s', serial, 'shell',
      `screenrecord --time-limit ${Math.min(seconds, 180)} --bit-rate ${bitrate} ${devicePath}`],
    { env: this.env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    return child;
  }

  async recordStop(child) { if (child) killTree(child); }

  async pull(serial, devicePath, localPath) {
    return this.cmd(['-s', serial, 'pull', devicePath, localPath], { timeout: 600000 });
  }

  async push(serial, localPath, devicePath) {
    return this.cmd(['-s', serial, 'push', localPath, devicePath], { timeout: 600000 });
  }

  /**
   * Install an APK. `-g` grants all runtime permissions (game friendly),
   * `-r` reinstalls keeping data, `--bypass-low-target-sdk-block` helps with
   * old APKs on new Android versions.
   */
  async install(serial, apkPath, { grant = true, reinstall = true, downgrade = false } = {}) {
    const args = ['-s', serial, 'install'];
    if (reinstall) args.push('-r');
    if (grant) args.push('-g');
    if (downgrade) args.push('-d');
    args.push('--bypass-low-target-sdk-block');
    args.push(apkPath);
    const r = await this.cmd(args, { timeout: 900000 });
    const text = `${r.stdout}\n${r.stderr}`;
    const ok = /Success/i.test(text);
    if (!ok) {
      // Second chance without exotic flags (older platform-tools / devices).
      const r2 = await this.cmd(['-s', serial, 'install', ...(grant ? ['-g'] : []), apkPath], { timeout: 900000 });
      const t2 = `${r2.stdout}\n${r2.stderr}`;
      return { ok: /Success/i.test(t2), output: t2, code: r2.code };
    }
    return { ok, output: text, code: r.code };
  }

  async packages(serial, { thirdPartyOnly = true } = {}) {
    const flag = thirdPartyOnly ? '-3' : '';
    const out = await tryRun(this.bin, ['-s', serial, 'shell', 'pm', 'list', 'packages', flag].filter(Boolean),
      { env: this.env, timeout: 60000 });
    if (out == null) return [];
    return out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).sort();
  }

  async appInfo(serial, pkg) {
    const out = await tryRun(this.bin, ['-s', serial, 'shell', 'dumpsys', 'package', pkg], { env: this.env, timeout: 60000 });
    if (!out) return null;
    const version = (out.match(/versionName=(\S+)/) || [])[1] || '';
    const label = (out.match(/applicationLabel=(.+)/) || [])[1] || '';
    const firstInstall = (out.match(/firstInstallTime=(.+)/) || [])[1] || '';
    return { pkg, version: version.trim(), label: label.trim(), firstInstall: firstInstall.trim() };
  }

  async launch(serial, pkg) {
    // monkey is the most reliable way to start the default launcher activity.
    const r = await this.sh(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
    if (r.code !== 0 || /No activities found/i.test(r.stdout + r.stderr)) {
      const act = await tryRun(this.bin, ['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg],
        { env: this.env, timeout: 30000 });
      const comp = act && act.split(/\r?\n/).filter(Boolean).pop();
      if (comp && comp.includes('/')) return this.sh(serial, `am start -n ${comp}`);
    }
    return r;
  }

  async stop(serial, pkg) { return this.sh(serial, `am force-stop ${pkg}`); }
  async clearData(serial, pkg) { return this.sh(serial, `pm clear ${pkg}`); }
  async uninstall(serial, pkg) { return this.cmd(['-s', serial, 'uninstall', pkg], { timeout: 120000 }); }

  // --- input ---------------------------------------------------------------
  async tap(serial, x, y) { return this.sh(serial, `input tap ${Math.round(x)} ${Math.round(y)}`); }
  async swipe(serial, x1, y1, x2, y2, ms = 200) {
    return this.sh(serial, `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(ms)}`);
  }
  async keyevent(serial, code) { return this.sh(serial, `input keyevent ${code}`); }
  async text(serial, str) {
    const escaped = String(str).replace(/(["'\\$`&|;<>()])/g, '\\$1').replace(/\s+/g, '%s');
    return this.sh(serial, `input text "${escaped}"`);
  }

  /** Long-lived shell for low-latency input (see LiveShell in proc.js). */
  live(serial) {
    if (!this.shells.has(serial)) this.shells.set(serial, new LiveShell(this.bin, serial, this.env));
    const s = this.shells.get(serial);
    s.start();
    return s;
  }

  tapLive(serial, x, y) { const s = this.live(serial); return s.send(`input tap ${Math.round(x)} ${Math.round(y)}`); }
  swipeLive(serial, x1, y1, x2, y2, ms = 180) {
    const s = this.live(serial);
    return s.send(`input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${Math.round(ms)}`);
  }
  keyLive(serial, code) { const s = this.live(serial); return s.send(`input keyevent ${code}`); }

  dropLive(serial) {
    const s = this.shells.get(serial);
    if (s) { s.stop(); this.shells.delete(serial); }
  }

  closeAll() { for (const serial of [...this.shells.keys()]) this.dropLive(serial); }

  // --- misc ----------------------------------------------------------------
  async rotate(serial, orientation /* 0..3 */) {
    await this.sh(serial, 'settings put system accelerometer_rotation 0');
    return this.sh(serial, `settings put system user_rotation ${orientation}`);
  }
  async volume(serial, direction) { return this.keyevent(serial, direction === 'up' ? 24 : 25); }
  async ime(serial) { return tryRun(this.bin, ['-s', serial, 'shell', 'settings', 'get', 'secure', 'default_input_method'], { env: this.env }); }
  async logcat(serial, lines = 400) {
    const out = await tryRun(this.bin, ['-s', serial, 'logcat', '-d', '-t', String(lines)], { env: this.env, timeout: 60000 });
    return out || '';
  }
  async top(serial) {
    const out = await tryRun(this.bin, ['-s', serial, 'shell', 'dumpsys', 'meminfo', '--package'], { env: this.env, timeout: 60000 });
    return out || '';
  }
  async freeStorage(serial) {
    const out = await tryRun(this.bin, ['-s', serial, 'shell', 'df', '/data'], { env: this.env, timeout: 30000 });
    return out || '';
  }
  async reboot(serial) { return this.cmd(['-s', serial, 'reboot'], { timeout: 30000 }); }
  async emu(serial, command) { return this.cmd(['-s', serial, 'emu', ...String(command).split(' ')], { timeout: 60000 }); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { Adb, sleep };
