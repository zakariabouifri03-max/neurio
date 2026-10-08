import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const NATIVE_HOST_NAME = 'com.aidownloadmanager.pro';
export const CHROME_EXTENSION_ID = 'ogeaplcpoffbfdbamhbflnkfmapahajn';
export const FIREFOX_EXTENSION_ID = 'ai-download-manager-pro@local';

function getExtensionDirectory(isPackaged, appPath, resourcesPath) {
  if (isPackaged) return path.join(resourcesPath, 'browser-bridge', 'extension');
  return path.join(appPath, 'browser-bridge', 'extension');
}

export async function installBrowserBridge({ app, appDataDirectory, isPackaged = app.isPackaged, appPath = app.getAppPath(), resourcesPath = process.resourcesPath } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('The browser native-messaging installer is currently available on Windows.');
  }
  if (!isPackaged) throw new Error('Package the Windows application before enabling the browser native-messaging host.');
  if (process.env.PORTABLE_EXECUTABLE_DIR) throw new Error('Install the Windows installer build before enabling browser integration. Portable app extraction paths are temporary.');

  const bridgeDirectory = path.join(appDataDirectory, 'browser-bridge');
  await fs.mkdir(bridgeDirectory, { recursive: true });
  const manifestPath = path.join(bridgeDirectory, `${NATIVE_HOST_NAME}.json`);
  const nativeHostPath = path.join(resourcesPath, 'native-messaging-host.exe');
  try { await fs.access(nativeHostPath); } catch { throw new Error('The native-messaging host is missing from this installation. Repair or reinstall the app.'); }
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'AI Download Manager Pro — explicit user-initiated link handoff',
    path: nativeHostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`],
    allowed_extensions: [FIREFOX_EXTENSION_ID],
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const registryLocations = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  ];
  const installed = [];
  const failures = [];
  for (const key of registryLocations) {
    try {
      await execFileAsync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { windowsHide: true });
      installed.push(key);
    } catch (error) {
      failures.push({ key, message: error.message });
    }
  }
  if (!installed.length) throw new Error('Windows could not register the browser native-messaging host. Try running the app under your Windows account and check browser policy settings.');
  const extensionDirectory = getExtensionDirectory(isPackaged, appPath, resourcesPath);
  return { manifestPath, extensionDirectory, installed, failures };
}

export async function uninstallBrowserBridge() {
  if (process.platform !== 'win32') return { removed: [] };
  const locations = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
  ];
  const removed = [];
  for (const key of locations) {
    await execFileAsync('reg.exe', ['delete', key, '/f'], { windowsHide: true }).then(() => removed.push(key)).catch(() => {});
  }
  return { removed };
}

export function browserExtensionDirectory({ isPackaged, appPath, resourcesPath }) {
  return getExtensionDirectory(isPackaged, appPath, resourcesPath);
}
