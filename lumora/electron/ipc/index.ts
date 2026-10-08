import { BrowserWindow, dialog, ipcMain, net, shell, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { customTemplates, projects } from '../services/projects';
import { settings } from '../services/settings';
import { assetsDir, dataDir, secrets } from '../services/store';
import { aiService, guard } from '../services/ai';
import { SECRET_KEYS } from '../services/ai/providers';
import type { AppSettings, ProjectDoc } from '../shared/types';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

function readImageAsDataUrl(file: string): { name: string; dataUrl: string } {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error('Unsupported image format.');
  const stat = fs.statSync(file);
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('Image is too large (max 40 MB).');
  const buf = fs.readFileSync(file);
  // Magic-number validation so a renamed executable cannot slip through.
  const sig = buf.subarray(0, 12);
  const isPNG = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
  const isJPG = sig[0] === 0xff && sig[1] === 0xd8;
  const isWEBP = sig.subarray(0, 4).toString('ascii') === 'RIFF' && sig.subarray(8, 12).toString('ascii') === 'WEBP';
  const isGIF = sig.subarray(0, 3).toString('ascii') === 'GIF';
  const isSVG = ext === '.svg' && buf.subarray(0, 1024).toString('utf8').toLowerCase().includes('<svg');
  if (!(isPNG || isJPG || isWEBP || isGIF || isSVG)) throw new Error('Unsupported image format.');
  return { name: path.basename(file), dataUrl: `data:${MIME[ext]};base64,${buf.toString('base64')}` };
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const handle = (channel: string, fn: (...args: any[]) => any) =>
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? 'Operation failed.' };
      }
    });

  /* ---------- app ---------- */
  handle('app:info', () => ({
    version: app.getVersion(),
    name: 'Lumora Studio',
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir: dataDir()
  }));
  handle('app:online', () => net.isOnline());
  handle('app:openDataFolder', () => shell.openPath(dataDir()));
  handle('app:openExternal', (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Blocked unsafe URL.');
    return shell.openExternal(url);
  });
  handle('app:storageUsage', () => {
    const walk = (dir: string): number =>
      fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => {
            const p = path.join(dir, e.name);
            return sum + (e.isDirectory() ? walk(p) : fs.statSync(p).size);
          }, 0)
        : 0;
    return { bytes: walk(dataDir()), path: dataDir() };
  });

  /* ---------- projects ---------- */
  handle('projects:list', () => projects.list());
  handle('projects:get', (id: string) => projects.get(id));
  handle('projects:create', (doc: any) => projects.create(doc));
  handle('projects:save', (doc: ProjectDoc) => projects.save(doc));
  handle('projects:rename', (id: string, name: string) => projects.rename(id, name));
  handle('projects:duplicate', (id: string) => projects.duplicate(id));
  handle('projects:delete', (id: string) => projects.remove(id));
  handle('projects:exportFile', async (id: string, name: string) => {
    const win = getWindow();
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: `${name || 'project'}.lumora.json`,
      filters: [{ name: 'Lumora Project', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return null;
    return projects.exportFile(id, res.filePath);
  });
  handle('projects:importFile', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Lumora Project', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return projects.importFile(res.filePaths[0]);
  });

  /* ---------- templates ---------- */
  handle('templates:list', () => customTemplates.list());
  handle('templates:save', (t: any) => customTemplates.save(t));
  handle('templates:delete', (id: string) => customTemplates.remove(id));

  /* ---------- files ---------- */
  handle('files:pickImages', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }]
    });
    if (res.canceled) return [];
    return res.filePaths.map(readImageAsDataUrl);
  });
  handle('files:readImage', (filePath: string) => readImageAsDataUrl(filePath));
  handle('files:pickFonts', async () => {
    const win = getWindow();
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    });
    if (res.canceled) return [];
    return res.filePaths.map((f) => {
      const buf = fs.readFileSync(f);
      if (buf.length > 20 * 1024 * 1024) throw new Error('Font file is too large.');
      const ext = path.extname(f).toLowerCase().slice(1);
      const mime = ext === 'otf' ? 'font/otf' : ext === 'ttf' ? 'font/ttf' : `font/${ext}`;
      return {
        family: path.basename(f, path.extname(f)).replace(/[^\w\s-]/g, ''),
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`
      };
    });
  });
  handle('files:saveAsset', (name: string, dataUrl: string) => {
    const safe = name.replace(/[^\w.-]/g, '_').slice(0, 80);
    const file = path.join(assetsDir(), `${Date.now()}_${safe}`);
    const b64 = dataUrl.split(',')[1] ?? '';
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return file;
  });
  handle('files:exportBinary', async (suggestedName: string, base64: string, ext: string) => {
    const win = getWindow();
    const filters: Record<string, string[]> = {
      png: ['png'],
      jpeg: ['jpg', 'jpeg'],
      webp: ['webp'],
      pdf: ['pdf'],
      svg: ['svg']
    };
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: suggestedName,
      filters: [{ name: ext.toUpperCase(), extensions: filters[ext] ?? [ext] }]
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
    return res.filePath;
  });
  handle('files:showItem', (p: string) => shell.showItemInFolder(p));

  /* ---------- settings & secrets ---------- */
  handle('settings:get', () => settings.get());
  handle('settings:update', (patch: Partial<AppSettings>) => settings.update(patch));
  handle('settings:reset', () => settings.reset());
  handle('secrets:status', () => aiService.status());
  handle('secrets:set', (provider: keyof typeof SECRET_KEYS, value: string) => {
    const key = SECRET_KEYS[provider];
    if (!key) throw new Error('Unknown provider.');
    secrets.set(key, String(value ?? '').trim());
    return aiService.status();
  });

  /* ---------- AI ---------- */
  ipcMain.handle('ai:text', (_e, task: any, input: string, extra?: string) =>
    guard(() => aiService.text.run(task, input, extra))
  );
  ipcMain.handle('ai:image', (_e, req: any) => guard(() => aiService.image.generate(req)));
  ipcMain.handle('ai:removeBackground', (_e, dataUrl: string) => guard(() => aiService.background.remove(dataUrl)));
  ipcMain.handle('ai:upscale', (_e, dataUrl: string, scale: 2 | 4) => guard(() => aiService.upscale.upscale(dataUrl, scale)));
  ipcMain.handle('ai:design', (_e, req: any) => guard(() => aiService.design.generate(req)));
  ipcMain.handle('ai:regenerateText', (_e, current: string, brief: string) =>
    guard(() => aiService.design.regenerateText(current, brief))
  );
}
