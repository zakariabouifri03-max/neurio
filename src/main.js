const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2048;
const PRESETS = {
  balanced: { sharpness: 58, noise: 24, color: 55 },
  details: { sharpness: 82, noise: 18, color: 52 },
  color: { sharpness: 52, noise: 22, color: 82 },
  soft: { sharpness: 36, noise: 62, color: 48 },
};

const ui = {
  sidebar: $('#sidebar'),
  sidebarBackdrop: $('#sidebarBackdrop'),
  mobileMenuButton: $('#mobileMenuButton'),
  dropzone: $('#dropzone'),
  dropHeading: $('#dropHeading'),
  dropDescription: $('#dropDescription'),
  chooseButton: $('#chooseFileButton'),
  chooseButtonLabel: $('#chooseButtonLabel'),
  formatHint: $('#formatHint'),
  mediaInput: $('#mediaInput'),
  replacementInput: $('#replacementInput'),
  editorPanel: $('#editorPanel'),
  fileName: $('#fileName'),
  fileDetails: $('#fileDetails'),
  fileTypeBadge: $('#fileTypeBadge'),
  fileTypeIcon: $('#fileTypeIcon'),
  replaceFileButton: $('#replaceFileButton'),
  clearFileButton: $('#clearFileButton'),
  compareToggle: $('#compareToggle'),
  previewDimensions: $('#previewDimensions'),
  previewState: $('.preview-state'),
  previewStateText: $('#previewStateText'),
  previewHint: $('#previewHint'),
  imageStage: $('#imageStage'),
  originalPreview: $('#originalPreview'),
  enhancedPreview: $('#enhancedPreview'),
  compareRange: $('#compareRange'),
  imageBusy: $('#imageBusy'),
  videoStage: $('#videoStage'),
  videoCanvas: $('#videoCanvas'),
  videoSource: $('#videoSource'),
  videoWatermark: $('#videoWatermark'),
  largePlayButton: $('#largePlayButton'),
  videoControls: $('#videoControls'),
  playButton: $('#playButton'),
  muteButton: $('#muteButton'),
  seekRange: $('#seekRange'),
  currentTime: $('#currentTime'),
  videoDuration: $('#videoDuration'),
  exportProgress: $('#exportProgress'),
  exportStatus: $('#exportStatus'),
  exportPercent: $('#exportPercent'),
  exportProgressBar: $('#exportProgressBar'),
  resolutionControl: $('#resolutionControl'),
  sharpnessRange: $('#sharpnessRange'),
  noiseRange: $('#noiseRange'),
  colorRange: $('#colorRange'),
  sharpnessValue: $('#sharpnessValue'),
  noiseValue: $('#noiseValue'),
  colorValue: $('#colorValue'),
  actionButton: $('#actionButton'),
  actionButtonTitle: $('#actionButtonTitle'),
  actionButtonCaption: $('#actionButtonCaption'),
  toast: $('#toast'),
  infoDialog: $('#infoDialog'),
};

const state = {
  mode: 'image',
  file: null,
  objectUrl: null,
  assetVersion: 0,
  busy: false,
  exporting: false,
  didEnhance: false,
  imageReady: false,
  imageWidth: 0,
  imageHeight: 0,
  originalWidth: 0,
  originalHeight: 0,
  imageScale: 1,
  imageSourceCanvas: null,
  imageSoftCanvas: null,
  fallbackPixels: null,
  videoReady: false,
  videoProcessor: null,
  videoFrame: 0,
  imageRenderToken: 0,
  imageDebounce: 0,
  exportTimer: 0,
  recorder: null,
  settings: { ...PRESETS.balanced },
};

let imageWorker = null;
let imageWorkerReady = null;
let imageWorkerReadyResolve = null;
let imageWorkerReadyReject = null;
let imageWorkerFailed = false;
const pendingWorkerLoads = new Map();
const pendingWorkerRenders = new Map();
let toastTimer = 0;

const IMAGE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.2-4.1a1.5 1.5 0 0 1 2.1 0l1.5 1.4 2.4-2.3a1.5 1.5 0 0 1 2.1 0L20.5 15"/></svg>';
const VIDEO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3z"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6V6Z"/></svg>';
const PAUSE_ICON = '<svg class="playing-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM15 5h4v14h-4z"/></svg>';
const VOLUME_ON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6m2.5-8.5a8.5 8.5 0 0 1 0 11"/></svg>';
const VOLUME_OFF_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="m17 9 4 6m0-6-4 6"/></svg>';

function showToast(message, isError = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle('error', isError);
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3200);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function safeBaseName(name) {
  const base = String(name || 'neurio-media').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return base || 'neurio-media';
}

function getSettings() {
  return {
    sharpness: Number(ui.sharpnessRange.value),
    noise: Number(ui.noiseRange.value),
    color: Number(ui.colorRange.value),
  };
}

function syncActionButton() {
  const hasFile = !!state.file;
  let disabled = !hasFile || state.busy || state.exporting;
  let title = 'حمّل ملفاً للبدء';
  let caption = 'اختار صورة أو فيديو أولاً';

  if (hasFile && state.mode === 'image') {
    if (!state.imageReady) {
      disabled = true;
      title = 'كنوجدّو الصورة…';
      caption = 'كنجهّزو المعاينة ديالك';
    } else {
      title = state.busy ? 'جاري تحسين الصورة…' : (state.didEnhance ? 'حمّل الصورة المحسّنة' : 'حسّن الصورة الآن');
      caption = state.busy ? 'كنجهّزو المعاينة ديالك' : (state.didEnhance ? 'النسخة جاهزة بصيغة PNG' : 'معاينة محلية بضغطة وحدة');
    }
  } else if (hasFile && state.mode === 'video') {
    title = state.exporting ? 'كنصدّرو الفيديو…' : 'صدّر الفيديو المحسّن';
    caption = state.exporting ? 'خلي الصفحة مفتوحة حتى يسالي' : 'التصدير كيتسجل في الوقت الحقيقي';
    if (!state.videoReady) {
      disabled = true;
      caption = 'كنوجدّو معاينة الفيديو…';
    } else if (!supportsVideoExport()) {
      disabled = true;
      caption = 'التصدير غير مدعوم فهاد المتصفح';
    }
  }

  ui.actionButton.disabled = disabled;
  ui.actionButton.classList.toggle('busy', state.busy || state.exporting);
  ui.actionButtonTitle.textContent = title;
  ui.actionButtonCaption.textContent = caption;
}

function supportsVideoExport() {
  return typeof MediaRecorder !== 'undefined'
    && typeof ui.videoCanvas.captureStream === 'function'
    && typeof window.MediaStream !== 'undefined';
}

function setMode(mode) {
  if (mode !== 'image' && mode !== 'video') return;
  if (state.mode === mode) return;
  if (state.exporting) {
    showToast('خلي التصدير يسالي قبل ما تبدّل نوع الملف.');
    return;
  }

  const hasMismatchedAsset = state.file && ((mode === 'image' && !state.file.type.startsWith('image/')) || (mode === 'video' && !state.file.type.startsWith('video/')));
  if (hasMismatchedAsset) clearWorkspace(false);

  state.mode = mode;
  $$('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  if (mode === 'image') {
    ui.mediaInput.accept = 'image/*';
    ui.replacementInput.accept = 'image/*';
    ui.dropHeading.textContent = 'جرّ صورتك لهنا';
    ui.dropDescription.textContent = 'أو اختار ملف من الجهاز ديالك';
    ui.chooseButtonLabel.textContent = 'اختار صورة';
    ui.formatHint.textContent = 'JPG · PNG · WEBP';
    ui.resolutionControl.hidden = false;
  } else {
    ui.mediaInput.accept = 'video/*';
    ui.replacementInput.accept = 'video/*';
    ui.dropHeading.textContent = 'جرّ الفيديو ديالك لهنا';
    ui.dropDescription.textContent = 'اختار فيديو من الجهاز باش تحسّن المعاينة ديالو';
    ui.chooseButtonLabel.textContent = 'اختار فيديو';
    ui.formatHint.textContent = 'MP4 · WEBM · MOV';
    ui.resolutionControl.hidden = true;
  }
  syncActionButton();
}

function clearWorkspace(showMessage = false) {
  if (state.exporting) {
    showToast('ما يمكنش تحيّد الملف وهو كيتصدّر.');
    return;
  }

  state.assetVersion += 1;
  state.imageRenderToken += 1;
  clearTimeout(state.imageDebounce);
  if (imageWorker && !imageWorkerFailed) imageWorker.postMessage({ type: 'clear' });
  cancelAnimationFrame(state.videoFrame);
  state.videoFrame = 0;

  if (ui.videoSource) {
    ui.videoSource.pause();
    ui.videoSource.removeAttribute('src');
    ui.videoSource.load();
  }
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.file = null;
  state.busy = false;
  state.didEnhance = false;
  state.imageReady = false;
  state.videoReady = false;
  state.imageSourceCanvas = null;
  state.imageSoftCanvas = null;
  state.fallbackPixels = null;
  state.imageWidth = 0;
  state.imageHeight = 0;
  state.originalWidth = 0;
  state.originalHeight = 0;

  ui.editorPanel.hidden = true;
  ui.dropzone.hidden = false;
  ui.imageStage.hidden = true;
  ui.videoStage.hidden = true;
  ui.videoControls.hidden = true;
  ui.compareToggle.hidden = true;
  ui.exportProgress.hidden = true;
  ui.imageBusy.hidden = true;
  ui.imageStage.classList.remove('compare-off', 'before-only');
  ui.videoStage.classList.remove('original-mode');
  ui.originalPreview.removeAttribute('src');
  ui.compareRange.hidden = true;
  ui.videoSource.classList.remove('is-visible');
  ui.videoWatermark.hidden = false;
  ui.previewState.classList.remove('enhanced');
  ui.previewStateText.textContent = 'الأصلية';
  ui.previewDimensions.textContent = '—';
  ui.fileName.textContent = 'اسم الملف';
  ui.fileDetails.textContent = '—';
  ui.previewHint.textContent = 'حمّل الملف باش تشوف المعاينة ديالو هنا.';
  ui.mediaInput.value = '';
  ui.replacementInput.value = '';
  ui.seekRange.value = '0';
  ui.currentTime.textContent = '0:00';
  ui.videoDuration.textContent = '0:00';
  ui.largePlayButton.hidden = false;
  setPlayButton(false);
  resetCompareView();
  syncActionButton();
  if (showMessage) showToast('تحيّد الملف من مساحة العمل.');
}

function resetCompareView() {
  ui.imageStage.classList.remove('compare-off');
  ui.videoStage.classList.remove('original-mode');
  ui.compareToggle.querySelector('span').textContent = 'قارن';
}

function updateComparePosition() {
  const position = Number(ui.compareRange.value);
  ui.enhancedPreview.style.clipPath = `inset(0 0 0 ${position}%)`;
  ui.imageStage.style.setProperty('--compare-pos', `${position}%`);
}

function updateCompareButtonLabel() {
  if (state.mode === 'image') {
    const comparing = !ui.imageStage.classList.contains('compare-off');
    ui.compareToggle.querySelector('span').textContent = comparing ? 'عرض المحسّنة' : 'قارن الأصلية';
  } else {
    const original = ui.videoStage.classList.contains('original-mode');
    ui.compareToggle.querySelector('span').textContent = original ? 'عرض المحسّنة' : 'عرض الأصلية';
  }
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  ui.sharpnessRange.value = String(preset.sharpness);
  ui.noiseRange.value = String(preset.noise);
  ui.colorRange.value = String(preset.color);
  state.settings = { ...preset };
  ui.sharpnessValue.textContent = String(preset.sharpness);
  ui.noiseValue.textContent = String(preset.noise);
  ui.colorValue.textContent = String(preset.color);
  $$('.preset-button').forEach((button) => button.classList.toggle('selected', button.dataset.preset === name));
  settingsChanged();
}

function settingsChanged() {
  state.settings = getSettings();
  ui.sharpnessValue.textContent = String(state.settings.sharpness);
  ui.noiseValue.textContent = String(state.settings.noise);
  ui.colorValue.textContent = String(state.settings.color);
  $$('.preset-button').forEach((button) => button.classList.remove('selected'));

  if (state.mode === 'image' && state.file && state.imageReady && state.didEnhance) {
    clearTimeout(state.imageDebounce);
    state.imageDebounce = setTimeout(() => renderEnhancedImage(), 130);
  } else if (state.mode === 'video' && state.videoReady) {
    drawVideoFrame();
  }
}

function ensureImageWorker() {
  if (imageWorkerFailed || typeof Worker === 'undefined') return Promise.reject(new Error('Web Worker غير متوفر'));
  if (imageWorkerReady) return imageWorkerReady;

  imageWorker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' });
  imageWorkerReady = new Promise((resolve, reject) => {
    imageWorkerReadyResolve = resolve;
    imageWorkerReadyReject = reject;
  });
  imageWorker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === 'ready') {
      imageWorkerReadyResolve?.(true);
      imageWorkerReadyResolve = null;
      imageWorkerReadyReject = null;
      return;
    }
    if (message.type === 'loaded') {
      const pending = pendingWorkerLoads.get(message.token);
      if (pending) {
        pendingWorkerLoads.delete(message.token);
        pending.resolve(true);
      }
      return;
    }
    if (message.type === 'rendered') {
      const pending = pendingWorkerRenders.get(message.id);
      if (pending) {
        pendingWorkerRenders.delete(message.id);
        pending.resolve(message);
      }
    }
  };
  imageWorker.onerror = (event) => {
    imageWorkerFailed = true;
    const error = new Error(event.message || 'تعذّر تشغيل معالج الصور.');
    imageWorkerReadyReject?.(error);
    imageWorkerReadyResolve = null;
    imageWorkerReadyReject = null;
    pendingWorkerLoads.forEach((pending) => pending.reject(error));
    pendingWorkerRenders.forEach((pending) => pending.reject(error));
    pendingWorkerLoads.clear();
    pendingWorkerRenders.clear();
  };
  return imageWorkerReady;
}

function loadImagePixelsInWorker(width, height, sourceData, softenedData, token) {
  return new Promise((resolve, reject) => {
    pendingWorkerLoads.set(token, { resolve, reject });
    imageWorker.postMessage({
      type: 'load',
      token,
      width,
      height,
      sourceBuffer: sourceData.buffer,
      softenedBuffer: softenedData.buffer,
    }, [sourceData.buffer, softenedData.buffer]);
  });
}

function renderImagePixelsInWorker(settings, id) {
  return new Promise((resolve, reject) => {
    pendingWorkerRenders.set(id, { resolve, reject });
    imageWorker.postMessage({ type: 'render', id, settings });
  });
}

async function prepareImagePixels(image, version) {
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const fitScale = Math.min(1, MAX_IMAGE_SIDE / largestSide);
  const width = Math.max(1, Math.round(image.naturalWidth * fitScale));
  const height = Math.max(1, Math.round(image.naturalHeight * fitScale));

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('المتصفح ما قدرش يجهّز الصورة.');
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = 'high';
  sourceContext.drawImage(image, 0, 0, width, height);

  const softenedCanvas = document.createElement('canvas');
  softenedCanvas.width = width;
  softenedCanvas.height = height;
  const softenedContext = softenedCanvas.getContext('2d', { willReadFrequently: true });
  if (!softenedContext) throw new Error('المتصفح ما قدرش يجهّز الصورة.');
  softenedContext.filter = 'blur(1.1px)';
  softenedContext.drawImage(sourceCanvas, 0, 0, width, height);
  softenedContext.filter = 'none';

  const sourceData = sourceContext.getImageData(0, 0, width, height).data;
  const softenedData = softenedContext.getImageData(0, 0, width, height).data;
  state.imageWidth = width;
  state.imageHeight = height;
  state.imageSourceCanvas = sourceCanvas;
  state.imageSoftCanvas = softenedCanvas;

  try {
    await ensureImageWorker();
    if (version !== state.assetVersion) return;
    await loadImagePixelsInWorker(width, height, sourceData, softenedData, version);
    if (version === state.assetVersion) state.fallbackPixels = null;
  } catch (error) {
    if (version !== state.assetVersion) return;
    const fallbackSource = sourceContext.getImageData(0, 0, width, height).data;
    const fallbackSoft = softenedContext.getImageData(0, 0, width, height).data;
    state.fallbackPixels = { source: fallbackSource, softened: fallbackSoft, width, height };
  }

  if (version === state.assetVersion) state.imageReady = true;
}

function enhancePixelsLocally(source, softened, settings) {
  const output = new Uint8ClampedArray(source.length);
  const sharpness = (settings.sharpness / 100) * 1.65;
  const denoise = (settings.noise / 100) * 0.46;
  const saturation = 0.80 + (settings.color / 100) * 0.48;
  const contrast = 1.015 + (settings.sharpness / 100) * 0.105;
  for (let index = 0; index < source.length; index += 4) {
    const red = source[index], green = source[index + 1], blue = source[index + 2];
    const blurRed = softened[index], blurGreen = softened[index + 1], blurBlue = softened[index + 2];
    let r = red + (blurRed - red) * denoise + (red - blurRed) * sharpness;
    let g = green + (blurGreen - green) * denoise + (green - blurGreen) * sharpness;
    let b = blue + (blurBlue - blue) * denoise + (blue - blurBlue) * sharpness;
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = (luminance + (r - luminance) * saturation - 127.5) * contrast + 127.5;
    g = (luminance + (g - luminance) * saturation - 127.5) * contrast + 127.5;
    b = (luminance + (b - luminance) * saturation - 127.5) * contrast + 127.5;
    output[index] = r * 1.012;
    output[index + 1] = g * 1.012;
    output[index + 2] = b * 1.012;
    output[index + 3] = source[index + 3];
  }
  return output;
}

async function getEnhancedPixels(settings, token) {
  if (!state.fallbackPixels && imageWorker && !imageWorkerFailed) {
    const result = await renderImagePixelsInWorker(settings, token);
    return { ...result, width: state.imageWidth, height: state.imageHeight };
  }

  if (!state.fallbackPixels) {
    const sourceContext = state.imageSourceCanvas?.getContext('2d', { willReadFrequently: true });
    const softenedContext = state.imageSoftCanvas?.getContext('2d', { willReadFrequently: true });
    if (!sourceContext || !softenedContext) throw new Error('ما قدرناش نعاودو نجهّزو الصورة.');
    state.fallbackPixels = {
      source: sourceContext.getImageData(0, 0, state.imageWidth, state.imageHeight).data,
      softened: softenedContext.getImageData(0, 0, state.imageWidth, state.imageHeight).data,
      width: state.imageWidth,
      height: state.imageHeight,
    };
  }
  return {
    outputBuffer: enhancePixelsLocally(state.fallbackPixels.source, state.fallbackPixels.softened, settings).buffer,
    width: state.fallbackPixels.width,
    height: state.fallbackPixels.height,
    id: token,
  };
}

async function renderEnhancedImage() {
  if (!state.file || !state.imageReady || state.mode !== 'image') return;
  const assetVersion = state.assetVersion;
  const renderVersion = ++state.imageRenderToken;
  state.busy = true;
  state.didEnhance = true;
  ui.imageBusy.hidden = false;
  ui.imageStage.classList.remove('before-only', 'compare-off');
  ui.compareRange.hidden = false;
  ui.compareToggle.hidden = false;
  ui.previewHint.textContent = 'اسحب المؤشر وسط الصورة باش تقارن بين قبل ومن بعد.';
  ui.previewStateText.textContent = 'كنحسّنو المعاينة…';
  ui.previewState.classList.remove('enhanced');
  syncActionButton();

  try {
    const result = await getEnhancedPixels(getSettings(), renderVersion);
    if (assetVersion !== state.assetVersion || renderVersion !== state.imageRenderToken || state.mode !== 'image') return;
    const resultWidth = result.width || state.imageWidth;
    const resultHeight = result.height || state.imageHeight;
    const outputData = new Uint8ClampedArray(result.outputBuffer);
    const outputImage = new ImageData(outputData, resultWidth, resultHeight);
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = resultWidth;
    baseCanvas.height = resultHeight;
    const baseContext = baseCanvas.getContext('2d');
    if (!baseContext) throw new Error('المتصفح ما قدرش يرسم الصورة المحسّنة.');
    baseContext.putImageData(outputImage, 0, 0);

    const requestedScale = state.imageScale;
    const safeScale = Math.min(requestedScale, 4096 / Math.max(resultWidth, resultHeight));
    const outputWidth = Math.max(1, Math.round(resultWidth * safeScale));
    const outputHeight = Math.max(1, Math.round(resultHeight * safeScale));
    ui.enhancedPreview.width = outputWidth;
    ui.enhancedPreview.height = outputHeight;
    const outputContext = ui.enhancedPreview.getContext('2d');
    if (!outputContext) throw new Error('المتصفح ما قدرش يرسم الصورة المحسّنة.');
    outputContext.clearRect(0, 0, outputWidth, outputHeight);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(baseCanvas, 0, 0, outputWidth, outputHeight);

    if (safeScale < requestedScale) {
      ui.previewHint.textContent = 'تم تحديد التكبير باش تبقى الصورة خفيفة على المتصفح.';
    }
    ui.imageStage.classList.remove('before-only');
    ui.compareRange.hidden = false;
    ui.compareToggle.hidden = false;
    updateComparePosition();
    ui.previewStateText.textContent = 'المعاينة المحسّنة';
    ui.previewState.classList.add('enhanced');
    ui.previewDimensions.textContent = `${outputWidth} × ${outputHeight}`;
  } catch (error) {
    if (assetVersion === state.assetVersion && renderVersion === state.imageRenderToken) {
      state.didEnhance = false;
      showToast(error.message || 'وقع مشكل فمعالجة الصورة.', true);
    }
  } finally {
    if (assetVersion === state.assetVersion && renderVersion === state.imageRenderToken) {
      state.busy = false;
      ui.imageBusy.hidden = true;
      syncActionButton();
    }
  }
}

function prepareImagePreview(file, objectUrl, version) {
  state.originalWidth = 0;
  state.originalHeight = 0;
  state.imageReady = false;
  state.didEnhance = false;
  ui.imageStage.hidden = false;
  ui.videoStage.hidden = true;
  ui.videoControls.hidden = true;
  ui.resolutionControl.hidden = false;
  ui.imageStage.classList.add('before-only');
  ui.imageStage.classList.remove('compare-off');
  ui.compareRange.hidden = true;
  ui.compareToggle.hidden = true;
  ui.imageBusy.hidden = true;
  ui.previewStateText.textContent = 'الصورة الأصلية';
  ui.previewState.classList.remove('enhanced');
  ui.previewHint.textContent = 'الصورة ديالك باقية فالجهاز؛ اضغط على «حسّن الصورة» باش تشوف الفرق.';

  const image = new Image();
  image.decoding = 'async';
  image.onload = async () => {
    if (version !== state.assetVersion) return;
    state.originalWidth = image.naturalWidth;
    state.originalHeight = image.naturalHeight;
    ui.originalPreview.src = objectUrl;
    ui.originalPreview.alt = `معاينة الصورة الأصلية: ${file.name}`;
    ui.previewDimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
    ui.fileDetails.textContent = `${formatBytes(file.size)} · ${image.naturalWidth} × ${image.naturalHeight}`;
    state.busy = true;
    ui.imageBusy.hidden = false;
    ui.previewStateText.textContent = 'كنوجدّو الصورة…';
    syncActionButton();
    try {
      await prepareImagePixels(image, version);
      if (version !== state.assetVersion) return;
      ui.imageBusy.hidden = true;
      ui.previewStateText.textContent = 'الصورة الأصلية';
      state.busy = false;
      syncActionButton();
    } catch (error) {
      if (version !== state.assetVersion) return;
      state.busy = false;
      ui.imageBusy.hidden = true;
      syncActionButton();
      showToast(error.message || 'ما قدرناش نقرّاو هاد الصورة.', true);
    }
  };
  image.onerror = () => {
    if (version !== state.assetVersion) return;
    state.busy = false;
    ui.imageBusy.hidden = true;
    syncActionButton();
    showToast('هاد الصورة ما قدرش المتصفح يفتحها.', true);
  };
  image.src = objectUrl;
}

class LocalVideoProcessor {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.context2d = null;
    this.program = null;
    this.texture = null;
    this.texelLocation = null;
    this.uniforms = {};
    if (this.gl) {
      try {
        this.initializeWebGL();
      } catch (error) {
        console.warn('Neurio video shader initialization failed:', error);
        this.gl = null;
      }
    }
    if (!this.gl) {
      this.context2d = canvas.getContext('2d', { alpha: false });
    }
  }

  initializeWebGL() {
    const gl = this.gl;
    const vertexSource = `
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }
    `;
    const fragmentSource = `
      precision mediump float;
      varying vec2 vTexCoord;
      uniform sampler2D uVideo;
      uniform vec2 uTexel;
      uniform float uSharpness;
      uniform float uDenoise;
      uniform float uSaturation;
      uniform float uContrast;
      uniform float uBrightness;
      void main() {
        vec3 center = texture2D(uVideo, vTexCoord).rgb;
        vec3 around = texture2D(uVideo, vTexCoord + vec2(uTexel.x, 0.0)).rgb
                    + texture2D(uVideo, vTexCoord - vec2(uTexel.x, 0.0)).rgb
                    + texture2D(uVideo, vTexCoord + vec2(0.0, uTexel.y)).rgb
                    + texture2D(uVideo, vTexCoord - vec2(0.0, uTexel.y)).rgb;
        vec3 softened = (center * 4.0 + around) / 8.0;
        vec3 color = mix(center, softened, uDenoise) + (center - softened) * uSharpness;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luminance), color, uSaturation);
        color = (color - 0.5) * uContrast + 0.5;
        color *= uBrightness;
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `;

    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'تعذّر تهيئة فلتر الفيديو.';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    this.program = program;
    gl.useProgram(program);

    const vertices = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    const texCoord = gl.getAttribLocation(program, 'aTexCoord');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texCoord);
    gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8);

    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, 'uVideo'), 0);
    this.texelLocation = gl.getUniformLocation(program, 'uTexel');
    this.uniforms = {
      sharpness: gl.getUniformLocation(program, 'uSharpness'),
      denoise: gl.getUniformLocation(program, 'uDenoise'),
      saturation: gl.getUniformLocation(program, 'uSaturation'),
      contrast: gl.getUniformLocation(program, 'uContrast'),
      brightness: gl.getUniformLocation(program, 'uBrightness'),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'تعذّر تجهيز فلتر الفيديو.';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.gl) this.gl.viewport(0, 0, width, height);
  }

  render(video, settings) {
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    const sharp = (settings.sharpness / 100) * 1.4;
    const denoise = (settings.noise / 100) * 0.42;
    const saturation = 0.80 + (settings.color / 100) * 0.48;
    const contrast = 1.015 + (settings.sharpness / 100) * 0.09;

    if (this.gl) {
      const gl = this.gl;
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.uniform2f(this.texelLocation, 1 / video.videoWidth, 1 / video.videoHeight);
      gl.uniform1f(this.uniforms.sharpness, sharp);
      gl.uniform1f(this.uniforms.denoise, denoise);
      gl.uniform1f(this.uniforms.saturation, saturation);
      gl.uniform1f(this.uniforms.contrast, contrast);
      gl.uniform1f(this.uniforms.brightness, 1.012);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    if (this.context2d) {
      this.context2d.filter = `brightness(1.012) contrast(${contrast}) saturate(${saturation})`;
      this.context2d.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      this.context2d.filter = 'none';
    }
  }
}

function setPlayButton(isPlaying) {
  ui.playButton.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
  ui.playButton.setAttribute('aria-label', isPlaying ? 'إيقاف مؤقت' : 'تشغيل الفيديو');
  ui.largePlayButton.hidden = isPlaying;
}

function drawVideoFrame() {
  if (!state.videoReady || !state.videoProcessor || state.mode !== 'video') return;
  try {
    state.videoProcessor.render(ui.videoSource, getSettings());
  } catch (error) {
    console.warn('Neurio could not draw a video frame:', error);
  }
}

function startVideoRenderLoop() {
  cancelAnimationFrame(state.videoFrame);
  const render = () => {
    drawVideoFrame();
    if (!ui.videoSource.paused && !ui.videoSource.ended && state.mode === 'video') {
      state.videoFrame = requestAnimationFrame(render);
    } else {
      state.videoFrame = 0;
    }
  };
  state.videoFrame = requestAnimationFrame(render);
}

function setVideoProgress() {
  const duration = ui.videoSource.duration;
  const current = ui.videoSource.currentTime;
  ui.currentTime.textContent = formatTime(current);
  ui.videoDuration.textContent = formatTime(duration);
  if (Number.isFinite(duration) && duration > 0 && !ui.seekRange.matches(':active')) {
    ui.seekRange.value = String(Math.round((current / duration) * 1000));
  }
  if (state.exporting && Number.isFinite(duration) && duration > 0) {
    const percentage = Math.max(0, Math.min(100, (current / duration) * 100));
    ui.exportPercent.textContent = `${Math.floor(percentage)}%`;
    ui.exportProgressBar.style.width = `${percentage}%`;
    ui.exportStatus.textContent = `كنسجلو الفيديو… ${formatTime(current)} من ${formatTime(duration)}`;
  }
}

function seekVideoTo(time) {
  return new Promise((resolve) => {
    const video = ui.videoSource;
    if (!Number.isFinite(time) || video.readyState < 1 || Math.abs(video.currentTime - time) < 0.04) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', done);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', done, { once: true });
    video.currentTime = time;
    setTimeout(done, 1200);
  });
}

function prepareVideoPreview(file, objectUrl, version) {
  state.videoReady = false;
  state.didEnhance = false;
  ui.imageStage.hidden = true;
  ui.videoStage.hidden = false;
  ui.videoControls.hidden = false;
  ui.resolutionControl.hidden = true;
  ui.compareToggle.hidden = false;
  ui.videoStage.classList.remove('original-mode');
  ui.videoWatermark.hidden = false;
  ui.previewHint.textContent = 'حرّك الفيديو وشوف التغييرات مباشرة؛ التصدير كيدوز في الوقت الحقيقي.';
  ui.previewStateText.textContent = 'المعاينة المحسّنة';
  ui.previewState.classList.add('enhanced');
  ui.videoDuration.textContent = '0:00';
  ui.currentTime.textContent = '0:00';
  ui.seekRange.value = '0';
  ui.largePlayButton.hidden = false;
  setPlayButton(false);
  ui.videoSource.pause();
  ui.videoSource.muted = false;
  ui.videoSource.volume = 1;

  let metadataHandled = false;
  const onMetadata = () => {
    if (metadataHandled || version !== state.assetVersion) return;
    metadataHandled = true;
    const video = ui.videoSource;
    if (!video.videoWidth || !video.videoHeight) {
      showToast('ما قدرش المتصفح يقرا أبعاد هاد الفيديو.', true);
      return;
    }
    state.videoProcessor = state.videoProcessor || new LocalVideoProcessor(ui.videoCanvas);
    const largestSide = Math.max(video.videoWidth, video.videoHeight);
    const fitScale = Math.min(1, 4096 / largestSide);
    const width = Math.max(1, Math.round(video.videoWidth * fitScale));
    const height = Math.max(1, Math.round(video.videoHeight * fitScale));
    state.videoProcessor.resize(width, height);
    state.videoReady = true;
    ui.previewDimensions.textContent = `${width} × ${height} · ${formatTime(video.duration)}`;
    ui.fileDetails.textContent = `${formatBytes(file.size)} · ${video.videoWidth} × ${video.videoHeight} · ${formatTime(video.duration)}`;
    setVideoProgress();
    drawVideoFrame();
    syncActionButton();
  };
  const onError = () => {
    if (version !== state.assetVersion) return;
    state.videoReady = false;
    syncActionButton();
    showToast('هاد الفيديو ما قدرش المتصفح يشغّلو. جرّب MP4 أو WebM.', true);
  };
  ui.videoSource.addEventListener('loadedmetadata', onMetadata, { once: true });
  ui.videoSource.addEventListener('error', onError, { once: true });
  ui.videoSource.src = objectUrl;
  ui.videoSource.load();
  if (ui.videoSource.readyState >= 1) onMetadata();
}

function inferMediaKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff'].includes(extension)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', 'ogv', 'avi'].includes(extension)) return 'video';
  return null;
}

async function openFile(file) {
  if (!file) return;
  if (state.exporting) {
    showToast('خلي الفيديو الحالي يسالي قبل ما تبدّل الملف.');
    return;
  }
  const kind = inferMediaKind(file);
  if (!kind) {
    showToast('اختار صورة أو فيديو بصيغة معروفة.', true);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showToast('الملف كبير بزاف؛ الحد الأقصى هو 40 MB.', true);
    return;
  }

  if (state.mode !== kind) setMode(kind);
  clearWorkspace(false);
  state.mode = kind;
  const version = state.assetVersion;
  state.file = file;
  state.objectUrl = URL.createObjectURL(file);
  ui.dropzone.hidden = true;
  ui.editorPanel.hidden = false;
  ui.fileName.textContent = file.name;
  ui.fileDetails.textContent = `${formatBytes(file.size)} · جاري التحضير…`;
  ui.fileTypeBadge.textContent = kind === 'image' ? 'صورة' : 'فيديو';
  ui.fileTypeBadge.classList.toggle('video-badge', kind === 'video');
  ui.fileTypeIcon.classList.toggle('video-type', kind === 'video');
  ui.fileTypeIcon.innerHTML = kind === 'image' ? IMAGE_ICON : VIDEO_ICON;
  ui.previewDimensions.textContent = 'كنوجدّو المعاينة…';
  resetCompareView();

  if (kind === 'image') {
    state.busy = true;
    syncActionButton();
    prepareImagePreview(file, state.objectUrl, version);
  } else {
    ui.videoStage.hidden = false;
    state.busy = true;
    syncActionButton();
    prepareVideoPreview(file, state.objectUrl, version);
    state.busy = false;
    syncActionButton();
  }
}

function setFileInputAccept() {
  const accept = state.mode === 'image' ? 'image/*' : 'video/*';
  ui.mediaInput.accept = accept;
  ui.replacementInput.accept = accept;
}

function downloadImage() {
  if (!state.didEnhance || !state.file || !ui.enhancedPreview.width) return;
  ui.enhancedPreview.toBlob((blob) => {
    if (!blob) {
      showToast('ما قدرناش نخرّجو الصورة. جرّب صيغة أو حجم آخر.', true);
      return;
    }
    const link = document.createElement('a');
    const scale = state.imageScale > 1 ? `-${state.imageScale}x` : '';
    link.href = URL.createObjectURL(blob);
    link.download = `${safeBaseName(state.file.name)}-neurio${scale}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
    showToast('الصورة المحسّنة واجدة للتحميل.');
  }, 'image/png');
}

function chooseRecorderMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function exportEnhancedVideo() {
  const video = ui.videoSource;
  if (!state.file || !state.videoReady || state.exporting) return;
  if (!supportsVideoExport()) {
    showToast('تصدير الفيديو غير مدعوم فهاد المتصفح. جرّب Chrome أو Edge حديث.', true);
    return;
  }

  let canvasStream;
  let sourceStream;
  let recorder;
  let mimeType = '';
  const chunks = [];
  const originalTime = video.currentTime;
  const originalMuted = video.muted;
  let settled = false;

  ui.videoStage.classList.remove('original-mode');
  ui.videoWatermark.innerHTML = '<i></i> معاينة محسّنة';
  updateCompareButtonLabel();

  try {
    video.pause();
    video.muted = false;
    await seekVideoTo(0);
    drawVideoFrame();
    canvasStream = ui.videoCanvas.captureStream(30);
    const capture = video.captureStream || video.mozCaptureStream;
    sourceStream = typeof capture === 'function' ? capture.call(video) : null;
    const tracks = [...canvasStream.getVideoTracks(), ...(sourceStream?.getAudioTracks() || [])];
    if (!tracks.some((track) => track.kind === 'video')) throw new Error('المتصفح ما قدرش يلتقط الفيديو المعالَج.');
    const outputStream = new MediaStream(tracks);
    mimeType = chooseRecorderMimeType();
    const recorderOptions = mimeType ? { mimeType, videoBitsPerSecond: Math.min(16_000_000, Math.max(4_000_000, ui.videoCanvas.width * ui.videoCanvas.height * 4)), audioBitsPerSecond: 128_000 } : undefined;
    recorder = recorderOptions ? new MediaRecorder(outputStream, recorderOptions) : new MediaRecorder(outputStream);
  } catch (error) {
    canvasStream?.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    video.muted = originalMuted;
    showToast(error.message || 'ما قدرناش نبداو تصدير الفيديو.', true);
    return;
  }

  state.exporting = true;
  state.recorder = recorder;
  ui.exportProgress.hidden = false;
  ui.exportPercent.textContent = '0%';
  ui.exportProgressBar.style.width = '0%';
  ui.exportStatus.textContent = 'كنوجدو الفيديو للتصدير…';
  syncActionButton();

  const stopAtEnd = () => {
    if (recorder.state === 'recording') recorder.stop();
  };
  const settle = async (error = null) => {
    if (settled) return;
    settled = true;
    clearInterval(state.exportTimer);
    state.exportTimer = 0;
    video.removeEventListener('ended', stopAtEnd);
    video.pause();
    video.muted = originalMuted;
    canvasStream?.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    state.exporting = false;
    state.recorder = null;

    if (!error) {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      if (!blob.size) error = new Error('ملف التصدير خرج خاوي؛ جرّب مرة أخرى.');
      else {
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${safeBaseName(state.file?.name)}-neurio.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
        ui.exportPercent.textContent = '100%';
        ui.exportProgressBar.style.width = '100%';
        ui.exportStatus.textContent = 'التصدير سالا — الملف كيتحمّل.';
        showToast('الفيديو المحسّن بدا كيتحمّل.');
      }
    }

    if (error) {
      ui.exportStatus.textContent = 'توقّف التصدير.';
      showToast(error.message || 'وقع مشكل فالتصدير.', true);
    }
    syncActionButton();
    if (state.file && state.mode === 'video') {
      await seekVideoTo(Math.min(originalTime, Number.isFinite(video.duration) ? video.duration : originalTime));
      drawVideoFrame();
    }
    setTimeout(() => {
      if (!state.exporting) ui.exportProgress.hidden = true;
    }, error ? 1400 : 3600);
  };

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  recorder.onerror = (event) => settle(event.error || new Error('توقّف تسجيل الفيديو بشكل غير متوقع.'));
  recorder.onstop = () => settle();
  video.addEventListener('ended', stopAtEnd, { once: true });
  state.exportTimer = setInterval(setVideoProgress, 300);

  try {
    recorder.start(1000);
    await video.play();
    startVideoRenderLoop();
    ui.exportStatus.textContent = 'كنسجلو الفيديو…';
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    await settle(error);
  }
}

function updateMuteButton() {
  const muted = ui.videoSource.muted;
  ui.muteButton.innerHTML = muted ? VOLUME_OFF_ICON : VOLUME_ON_ICON;
  ui.muteButton.setAttribute('aria-label', muted ? 'تشغيل الصوت' : 'كتم الصوت');
}

function openInfoDialog() {
  if (typeof ui.infoDialog.showModal === 'function') ui.infoDialog.showModal();
  else showToast('المعالجة محلية، وما كاين حتى ملف كيتصيفط للخارج.');
}

function openFilePicker(input) {
  setFileInputAccept();
  input.value = '';
  input.click();
}

function wireUI() {
  $$('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  $$('.preset-button').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $$('.scale-button').forEach((button) => button.addEventListener('click', () => {
    state.imageScale = Number(button.dataset.scale) || 1;
    $$('.scale-button').forEach((item) => item.classList.toggle('selected', item === button));
    if (state.didEnhance && state.imageReady) renderEnhancedImage();
  }));

  [ui.sharpnessRange, ui.noiseRange, ui.colorRange].forEach((input) => input.addEventListener('input', settingsChanged));
  $('#resetSettingsButton').addEventListener('click', () => {
    state.imageScale = 1;
    $$('.scale-button').forEach((button) => button.classList.toggle('selected', button.dataset.scale === '1'));
    applyPreset('balanced');
    showToast('رجّعنا الإعدادات للتوازن.');
  });

  ui.chooseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openFilePicker(ui.mediaInput);
  });
  ui.dropzone.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    openFilePicker(ui.mediaInput);
  });
  ui.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilePicker(ui.mediaInput);
    }
  });
  ui.mediaInput.addEventListener('change', () => openFile(ui.mediaInput.files?.[0]));
  ui.replacementInput.addEventListener('change', () => openFile(ui.replacementInput.files?.[0]));
  ui.replaceFileButton.addEventListener('click', () => openFilePicker(ui.replacementInput));
  ui.clearFileButton.addEventListener('click', () => clearWorkspace(true));

  ['dragenter', 'dragover'].forEach((eventName) => ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    ui.dropzone.classList.add('drag-active');
  }));
  ['dragleave', 'dragend'].forEach((eventName) => ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!ui.dropzone.contains(event.relatedTarget)) ui.dropzone.classList.remove('drag-active');
  }));
  ui.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    ui.dropzone.classList.remove('drag-active');
    const file = event.dataTransfer?.files?.[0];
    if (file) openFile(file);
  });

  ui.actionButton.addEventListener('click', () => {
    if (state.mode === 'image') {
      if (state.didEnhance) downloadImage();
      else renderEnhancedImage();
    } else exportEnhancedVideo();
  });
  ui.compareRange.addEventListener('input', updateComparePosition);
  ui.compareToggle.addEventListener('click', () => {
    if (!state.file) return;
    if (state.mode === 'image') ui.imageStage.classList.toggle('compare-off');
    else {
      const isOriginal = ui.videoStage.classList.toggle('original-mode');
      ui.videoWatermark.innerHTML = isOriginal ? '<i></i> المعاينة الأصلية' : '<i></i> معاينة محسّنة';
    }
    updateCompareButtonLabel();
  });

  const togglePlayback = async () => {
    if (!state.videoReady) return;
    if (ui.videoSource.paused) {
      try {
        await ui.videoSource.play();
        startVideoRenderLoop();
      } catch {
        showToast('ما قدرناش نشغلو الفيديو؛ تأكد من صيغة الملف.', true);
      }
    } else ui.videoSource.pause();
  };
  ui.playButton.addEventListener('click', togglePlayback);
  ui.largePlayButton.addEventListener('click', togglePlayback);
  ui.videoSource.addEventListener('play', () => {
    setPlayButton(true);
    startVideoRenderLoop();
  });
  ui.videoSource.addEventListener('pause', () => {
    setPlayButton(false);
    drawVideoFrame();
  });
  ui.videoSource.addEventListener('ended', () => {
    setPlayButton(false);
    drawVideoFrame();
  });
  ui.videoSource.addEventListener('timeupdate', setVideoProgress);
  ui.videoSource.addEventListener('seeked', drawVideoFrame);
  ui.videoSource.addEventListener('loadedmetadata', () => {
    if (state.mode === 'video') setVideoProgress();
  });
  ui.videoSource.addEventListener('volumechange', updateMuteButton);
  ui.muteButton.addEventListener('click', () => { ui.videoSource.muted = !ui.videoSource.muted; updateMuteButton(); });
  ui.seekRange.addEventListener('input', () => {
    if (!Number.isFinite(ui.videoSource.duration)) return;
    ui.videoSource.currentTime = (Number(ui.seekRange.value) / 1000) * ui.videoSource.duration;
    setVideoProgress();
  });

  $('#navEnhance').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileMenu();
  });
  $('#navPrivacy').addEventListener('click', () => { openInfoDialog(); closeMobileMenu(); });
  $('#topHelp').addEventListener('click', openInfoDialog);
  $('#sidebarBackdrop').addEventListener('click', closeMobileMenu);
  ui.mobileMenuButton.addEventListener('click', () => {
    ui.sidebar.classList.add('open');
    ui.sidebarBackdrop.classList.add('open');
  });
  $('#navGuide').addEventListener('click', closeMobileMenu);
}

function closeMobileMenu() {
  ui.sidebar.classList.remove('open');
  ui.sidebarBackdrop.classList.remove('open');
}

wireUI();
setMode('image');
applyPreset('balanced');
updateComparePosition();
updateMuteButton();
syncActionButton();
