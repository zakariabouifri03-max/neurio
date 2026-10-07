'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const f = (_e, ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };

contextBridge.exposeInMainWorld('mf', {
  app: {
    info: inv('app:info'),
    takeLaunchFile: inv('app:take-launch-file'),
    confirmClose: () => ipcRenderer.send('app:confirm-close'),
    setTitle: (t) => ipcRenderer.send('app:set-title', t),
    fullscreen: inv('app:toggle-fullscreen'),
    reveal: inv('app:reveal'),
    openExternal: inv('app:open-external'),
    selftestDone: inv('app:selftest-done'),
    onRequestClose: on('app:request-close'),
    onOpenFile: on('app:open-file'),
    pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  },
  dialog: { open: inv('dialog:open'), save: inv('dialog:save'), folder: inv('dialog:folder'), message: inv('dialog:message') },
  file: { read: inv('file:read'), write: inv('file:write'), stat: inv('file:stat') },
  project: { write: inv('project:write'), backups: inv('project:backups') },
  autosave: { write: inv('autosave:write'), list: inv('autosave:list'), read: inv('autosave:read'), remove: inv('autosave:remove') },
  settings: { get: inv('settings:get'), set: inv('settings:set') },
  secret: { set: inv('secret:set'), has: inv('secret:has') },
  ai: { request: inv('ai:request') },
  lib: { list: inv('lib:list'), put: inv('lib:put'), get: inv('lib:get'), remove: inv('lib:remove'), folders: inv('lib:folders') },
  ffmpeg: { caps: inv('ffmpeg:caps') },
  export: { begin: inv('export:begin'), frame: inv('export:frame'), finish: inv('export:finish'), cancel: inv('export:cancel') },
  media: { extractAudio: inv('media:extract-audio'), extractFrames: inv('media:extract-frames') },
});
