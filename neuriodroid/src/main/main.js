'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const pathsMod = require('./lib/paths');
const logger = require('./lib/logger');
const { Settings } = require('./lib/settings');
const { Adb } = require('./lib/adb');
const { Instances } = require('./lib/instances');
const avd = require('./lib/avd');
const sdk = require('./lib/sdk');
const remote = require('./lib/remote');
const accel = require('./lib/accel');
const sysinfo = require('./lib/sysinfo');
const { KeymapManager } = require('./lib/keymap');
const { WinBridge } = require('./lib/winbridge');

let win, paths, settings, adb, instances, keymap, bridge;
const controllers = new Map();

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function reply(event, data) { return data; }
function on(channel, fn) { ipcMain.handle(channel, async (event, args) => { try { return await fn(args || {}, event); } catch (e) { logger.scoped('ipc').error(channel, { error: e.message, stack: e.stack }); throw new Error(e.message || String(e)); } }); }

function createWindow() {
  const s = settings.get().window || {};
  win = new BrowserWindow({ width: s.width || 1280, height: s.height || 820, minWidth: 980, minHeight: 650, backgroundColor: '#070a16', title: 'NeurioDroid', icon: path.join(__dirname, '../../assets/icon-source.png'), webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true, sandbox: false } });
  if (s.maximized) win.maximize();
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.on('close', (e) => { if (settings.get().closeAction === 'minimize') { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

function setupIpc() {
  on('app:state', async () => ({ paths: paths.toJSON(), settings: settings.get(), sdk: sdk.status(paths, settings.get()), avds: avd.list(paths), instances: instances.list(), keymap: keymap.status() }));
  on('settings:set', async ({ patch }) => { const out = settings.set(patch); return out; });
  on('settings:reset', async () => settings.reset());
  on('dialog:openFile', async ({ filters }) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [{ name: 'APK', extensions: ['apk'] }] }); return r.canceled ? null : r.filePaths[0]; });
  on('dialog:chooseFolder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  on('shell:openPath', async ({ file }) => shell.openPath(file));
  on('sdk:discover', async ({ force }) => remote.discover({ cacheFile: paths.imagesCache, force, log: logger.scoped('remote') }));
  on('sdk:provision', async ({ image, abi }) => { const ac = new AbortController(); controllers.set('provision', ac); try { return await sdk.provision(paths, settings.get(), { image, abi, signal: ac.signal, onProgress: (p) => send('sdk:progress', p) }); } finally { controllers.delete('provision'); } });
  on('sdk:cancel', async () => { const c = controllers.get('provision'); if (c) c.abort(); return true; });
  on('sdk:status', async () => sdk.status(paths, settings.get()));
  on('diagnostics:collect', async () => ({ info: await sysinfo.collect(paths), accel: await accel.check(paths), diagnosis: accel.diagnose(await accel.check(paths)) }));
  on('diagnostics:enableWHPX', async () => accel.enableWhpx());
  on('diagnostics:disableHyperV', async () => accel.disableHyperV());
  on('avd:list', async () => avd.list(paths));
  on('avd:create', async ({ config }) => avd.create(paths, config));
  on('avd:update', async ({ name, patch }) => avd.update(paths, name, patch));
  on('avd:remove', async ({ name }) => avd.remove(paths, name));
  on('avd:clone', async ({ name, newName }) => avd.clone(paths, name, newName));
  on('avd:wipe', async ({ name }) => avd.wipeData(paths, name));
  on('avd:snapshots', async ({ name }) => avd.snapshots(paths, name));
  on('avd:deleteSnapshot', async ({ name, id }) => avd.deleteSnapshot(paths, name, id));
  on('instance:list', async () => instances.list());
  on('instance:start', async ({ name, options }) => instances.start(name, options || {}).then(i => i.public()));
  on('instance:stop', async ({ key, force }) => { const i = instances.get(key); return i ? i.stop({ force }) : false; });
  on('instance:forget', async ({ key }) => instances.forget(key));
  on('instance:screenshot', async ({ key }) => { const i = instances.get(key); return i ? i.screenshot() : null; });
  on('instance:recordStart', async ({ key, seconds }) => { const i = instances.get(key); return i ? i.startRecord({ seconds }) : null; });
  on('instance:recordStop', async ({ key }) => { const i = instances.get(key); return i ? i.stopRecord() : null; });
  on('instance:snapshotSave', async ({ key, id }) => { const i = instances.get(key); return i ? i.saveSnapshot(id) : null; });
  on('instance:snapshotLoad', async ({ key, id }) => { const i = instances.get(key); return i ? i.loadSnapshot(id) : null; });
  on('adb:devices', async () => adb.devices());
  on('adb:install', async ({ serial, apk, grant, reinstall }) => adb.install(serial, apk, { grant, reinstall }));
  on('adb:packages', async ({ serial }) => adb.packages(serial));
  on('adb:launch', async ({ serial, pkg }) => adb.launch(serial, pkg));
  on('adb:uninstall', async ({ serial, pkg }) => adb.uninstall(serial, pkg));
  on('adb:keyevent', async ({ serial, code }) => adb.keyevent(serial, code));
  on('keymap:status', async () => keymap.status());
  on('keymap:start', async ({ serial, profileId, key }) => { const i = key && instances.get(key); if (i) keymap.active && (keymap.active.instance = i); return keymap.start(serial, profileId); });
  on('keymap:stop', async () => keymap.stop());
  on('keymap:profile', async ({ profile }) => keymap.upsertProfile(profile));
  on('keymap:remove', async ({ id }) => keymap.removeProfile(id));
  on('win:focus', async ({ hwnd }) => bridge.focus(hwnd));
}

function wireEvents() {
  instances.on('state', (x) => send('instance:state', x));
  instances.on('list', (x) => send('instance:list', x));
  instances.on('log', (x) => send('instance:log', x));
  instances.on('preview', (x) => send('instance:preview', x));
  keymap.on('status', (x) => send('keymap:status', x));
  logger.on((x) => send('log:entry', x));
}

app.whenReady().then(() => {
  paths = pathsMod.init(); logger.attach(paths.logs); settings = new Settings(paths.settingsFile, logger.scoped('settings')); settings.load();
  if (settings.get().root && settings.get().root !== paths.root) { paths = pathsMod.reinit(settings.get().root); }
  adb = new Adb(paths); bridge = new WinBridge(); keymap = new KeymapManager(paths, adb); keymap.setWinBridge(bridge); instances = new Instances(paths, settings, adb);
  setupIpc(); wireEvents(); createWindow();
  app.on('activate', () => { if (!win) createWindow(); else win.show(); });
});
app.on('before-quit', async () => { try { await instances.stopAll(); adb.closeAll(); bridge.stop(); } catch (_) {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
