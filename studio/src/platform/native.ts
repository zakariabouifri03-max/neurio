/**
 * Platform glue for the packaged builds.
 *  - Android (Capacitor): blob: downloads don't work inside a WebView, so files are written to the
 *    device's Downloads folder with @capacitor/filesystem and offered through the share sheet.
 *  - Windows/macOS/Linux (Electron): regular anchor downloads are intercepted by the shell and shown
 *    in a native "Save as" dialog, so nothing special is needed here.
 */
import { Capacitor } from '@capacitor/core';

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const isDesktopShell = () => typeof (window as any).neurioDesktop !== 'undefined';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.readAsDataURL(blob);
  });
}

/** Save a blob on Android. Returns the native URI. Writes in 3 MB chunks so large exports don't blow the base64 bridge. */
export async function saveBlobNative(blob: Blob, filename: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const dir = Directory.Documents;
  const path = `Neurio/${filename}`;
  const CHUNK = 3 * 1024 * 1024; // multiple of 3 → clean base64 boundaries
  let first = true;
  for (let off = 0; off < blob.size || first; off += CHUNK) {
    const data = await blobToBase64(blob.slice(off, Math.min(blob.size, off + CHUNK)));
    if (first) {
      await Filesystem.writeFile({ path, data, directory: dir, recursive: true });
      first = false;
    } else {
      await Filesystem.appendFile({ path, data, directory: dir });
    }
    if (blob.size === 0) break;
  }
  const uri = (await Filesystem.getUri({ path, directory: dir })).uri;
  try {
    const { Share } = await import('@capacitor/share');
    if ((await Share.canShare()).value) await Share.share({ title: filename, url: uri, dialogTitle: 'Export saved — share or open' });
  } catch {
    /* sharing is optional */
  }
  return uri;
}

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0c0e14' });
  } catch {
    /* plugin missing on this platform */
  }
  try {
    const { App } = await import('@capacitor/app');
    // Android back button: close dialogs / go home instead of killing the app
    App.addListener('backButton', async () => {
      const { useUI } = await import('@/core/uiStore');
      const ui = useUI.getState();
      if (ui.dialog) ui.closeDialog();
      else if (ui.route.name === 'editor') {
        const { saveCurrent } = await import('@/services/projects');
        await saveCurrent();
        ui.navigate({ name: 'home' });
      } else App.exitApp();
    });
  } catch {
    /* ignore */
  }
}
