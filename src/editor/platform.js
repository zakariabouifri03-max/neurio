import { cacheMediaBlob, downloadProjectFile } from './storage.js';
import { makeId } from './project.js';

export const nativeBridge = () => typeof window === 'undefined' ? null : window.__TAURI__?.core ?? null;
export const isDesktopApp = () => Boolean(nativeBridge()?.invoke);

export async function invokeNative(command, args = {}) {
  const bridge = nativeBridge();
  if (!bridge) throw new Error('This operation requires the NEXUS Windows desktop runtime.');
  try { return await bridge.invoke(command, args); }
  catch (error) { throw new Error(typeof error === 'string' ? error : error?.message ?? String(error)); }
}

function chooseFiles(inputId, accept, multiple = false) {
  return new Promise((resolve) => {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return resolve([]);
    input.accept = accept;
    input.multiple = multiple;
    input.value = '';
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export async function pickMediaFiles() {
  if (isDesktopApp()) return invokeNative('pick_media_files');
  return chooseFiles('mediaInput', 'video/*,audio/*,image/png,image/jpeg,image/webp', true);
}

export async function pickProjectFile() {
  if (isDesktopApp()) return invokeNative('pick_project_file');
  const files = await chooseFiles('projectInput', '.nexusvideo,application/json', false);
  return files[0] ?? null;
}

export async function pickModelOrRuntimeFile(kind) {
  if (isDesktopApp()) return invokeNative('pick_model_or_runtime_file', { kind });
  const files = await chooseFiles('modelInput', kind.includes('runtime') || kind === 'ffmpeg' ? '.exe,application/octet-stream' : '.gguf,.bin,application/octet-stream', false);
  return files[0] ?? null;
}

export async function chooseProjectSavePath() {
  if (isDesktopApp()) return invokeNative('choose_project_save_path');
  return null;
}

export async function chooseExportPath(suggestedName = 'Nexus-Export.mp4') {
  if (isDesktopApp()) return invokeNative('choose_export_path', { suggestedName });
  return null;
}

export async function persistProject(project, projectPath = null) {
  if (isDesktopApp()) {
    const path = projectPath || await chooseProjectSavePath();
    if (!path) return null;
    await invokeNative('write_project_file', { path, json: JSON.stringify(project, null, 2) });
    return path;
  }
  downloadProjectFile(project);
  return 'downloaded';
}

export async function readProjectSelection() {
  const picked = await pickProjectFile();
  if (!picked) return null;
  if (typeof picked === 'string') {
    const json = await invokeNative('read_project_file', { path: picked });
    return { path: picked, project: JSON.parse(json) };
  }
  const json = await picked.text();
  return { path: null, project: JSON.parse(json) };
}

function extensionType(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
  return 'video';
}

function readBrowserMetadata(file, mediaType, url) {
  if (mediaType === 'image') {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ duration: 0, width: image.naturalWidth, height: image.naturalHeight, hasAudio: false });
      image.onerror = () => reject(new Error(`The image “${file.name}” could not be decoded.`));
      image.src = url;
    });
  }
  return new Promise((resolve, reject) => {
    const element = document.createElement(mediaType === 'audio' ? 'audio' : 'video');
    element.preload = 'metadata';
    element.onloadedmetadata = () => resolve({
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      width: element.videoWidth || 0,
      height: element.videoHeight || 0,
      hasAudio: mediaType === 'audio' || mediaType === 'video',
    });
    element.onerror = () => reject(new Error(`The media file “${file.name}” could not be decoded by this browser.`));
    element.src = url;
  });
}

export async function importPickedMedia(picked, onProgress = () => {}) {
  const items = typeof picked === 'string' ? [picked] : Array.from(picked ?? []);
  const assets = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    let temporaryUrl = null;
    try {
      let data;
      if (typeof item === 'string') {
        const info = await invokeNative('probe_media', { path: item });
        data = {
          id: makeId('asset'), name: item.split(/[\\/]/).pop() || 'Media', path: item,
          mediaType: info.mediaType, duration: info.duration, width: info.width, height: info.height,
          fps: info.fps, hasAudio: info.hasAudio, size: info.size,
        };
      } else {
        const mediaType = extensionType(item.name);
        const url = URL.createObjectURL(item);
        temporaryUrl = url;
        const info = await readBrowserMetadata(item, mediaType, url);
        const id = makeId('asset');
        const storageKey = `asset:${id}`;
        await cacheMediaBlob(storageKey, item);
        data = {
          id, name: item.name, path: null, storageKey, mediaType,
          duration: info.duration, width: info.width, height: info.height,
          fps: 0, hasAudio: info.hasAudio, size: item.size,
        };
        data.browserUrl = url;
        data.browserBlob = item;
      }
      assets.push(data);
      temporaryUrl = null;
    } catch (error) {
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
      console.error(error);
      onProgress({ index, total: items.length, error: error.message });
    }
    onProgress({ index: index + 1, total: items.length });
  }
  return assets;
}

export function getAssetUrl(asset, objectUrlMap = new Map()) {
  if (!asset) return '';
  if (asset.browserUrl) return asset.browserUrl;
  if (objectUrlMap.has(asset.id)) return objectUrlMap.get(asset.id);
  if (asset.path && window.__TAURI__?.core?.convertFileSrc) return window.__TAURI__.core.convertFileSrc(asset.path);
  return '';
}

export async function getBackendStatus() {
  if (!isDesktopApp()) return { desktop: false, ffmpeg: false, ffprobe: false, whisper: false, llama: false };
  return invokeNative('get_backend_status');
}

export async function getModelStatus() {
  if (!isDesktopApp()) return { desktop: false, llm: { installed: false }, whisper: { installed: false }, vision: { installed: false } };
  return invokeNative('get_model_status');
}

export async function setModelFile(kind, path) {
  if (typeof path !== 'string' || !path) throw new Error('Choose a local file first.');
  return invokeNative('set_model_path', { kind, path });
}

export async function listenNative(eventName, callback) {
  const eventApi = window.__TAURI__?.event;
  if (!eventApi?.listen) return () => {};
  const unlisten = await eventApi.listen(eventName, (event) => callback(event.payload));
  return unlisten;
}
