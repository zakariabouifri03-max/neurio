'use strict';
/**
 * Central path resolution for NeurioDroid.
 *
 * Everything the app downloads (JRE, Android SDK, system images, AVDs, logs)
 * lives under a single relocatable root so the user can move/backup/wipe it.
 *   Windows default : %LOCALAPPDATA%\NeurioDroid
 *   Linux/macOS     : ~/.neuriodroid   (dev only)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const IS_WIN = process.platform === 'win32';

function defaultRoot() {
  if (IS_WIN) {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'NeurioDroid');
  }
  return path.join(os.homedir(), '.neuriodroid');
}

class Paths {
  constructor(root) {
    this.root = root;
    this.runtime = path.join(root, 'runtime');
    this.jre = path.join(this.runtime, 'jre');
    this.sdk = path.join(root, 'sdk');
    this.cmdlineTools = path.join(this.sdk, 'cmdline-tools', 'latest');
    this.platformTools = path.join(this.sdk, 'platform-tools');
    this.emulator = path.join(this.sdk, 'emulator');
    this.avdHome = path.join(root, 'avd');
    this.androidHome = path.join(os.homedir(), '.android');
    this.downloads = path.join(root, 'downloads');
    this.logs = path.join(root, 'logs');
    this.captures = path.join(root, 'captures');
    this.records = path.join(root, 'records');
    this.apks = path.join(root, 'apks');
    this.shared = path.join(root, 'shared');
    this.config = path.join(root, 'config');
    this.settingsFile = path.join(this.config, 'settings.json');
    this.imagesCache = path.join(this.config, 'system-images.json');
    this.windowStateFile = path.join(this.config, 'window.json');
    this.temp = path.join(root, 'tmp');
  }

  ensure() {
    for (const dir of [
      this.root, this.runtime, this.sdk, this.avdHome, this.downloads,
      this.logs, this.captures, this.records, this.apks, this.shared,
      this.config, this.temp, this.androidHome,
    ]) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    }
    return this;
  }

  // --- binaries -----------------------------------------------------------
  get java() { return path.join(this.jre, 'bin', IS_WIN ? 'java.exe' : 'java'); }
  get sdkmanager() { return path.join(this.cmdlineTools, 'bin', IS_WIN ? 'sdkmanager.bat' : 'sdkmanager'); }
  get avdmanager() { return path.join(this.cmdlineTools, 'bin', IS_WIN ? 'avdmanager.bat' : 'avdmanager'); }
  get adb() { return path.join(this.platformTools, IS_WIN ? 'adb.exe' : 'adb'); }
  get emulatorBin() { return path.join(this.emulator, IS_WIN ? 'emulator.exe' : 'emulator'); }

  env(extra = {}) {
    return Object.assign({}, process.env, {
      ANDROID_HOME: this.sdk,
      ANDROID_SDK_ROOT: this.sdk,
      ANDROID_AVD_HOME: this.avdHome,
      ANDROID_EMULATOR_HOME: this.androidHome,
      JAVA_HOME: this.jre,
      // Keep the emulator from trying to phone home for stats.
      ANDROID_EMU_NO_METRICS: '1',
    }, extra);
  }

  toJSON() {
    return {
      root: this.root, runtime: this.runtime, jre: this.jre, sdk: this.sdk,
      cmdlineTools: this.cmdlineTools, platformTools: this.platformTools,
      emulator: this.emulator, avdHome: this.avdHome, androidHome: this.androidHome,
      downloads: this.downloads, logs: this.logs, captures: this.captures,
      records: this.records, apks: this.apks, shared: this.shared, config: this.config,
      java: this.java, sdkmanager: this.sdkmanager, avdmanager: this.avdmanager,
      adb: this.adb, emulatorBin: this.emulatorBin, isWindows: IS_WIN,
    };
  }
}

let current = null;

/** Initialise (once) with an optional user-chosen root. */
function init(root) {
  current = new Paths(root || defaultRoot()).ensure();
  return current;
}

function get() {
  if (!current) current = new Paths(defaultRoot()).ensure();
  return current;
}

/** Move to a new root (settings change). Existing data is *not* migrated. */
function reinit(root) { return init(root); }

module.exports = { init, get, reinit, defaultRoot, IS_WIN };
