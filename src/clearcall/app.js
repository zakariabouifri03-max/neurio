import {
  DEFAULT_ADJUSTMENTS,
  QUALITY_PROFILES,
  autoLightGain,
  buildFilter,
  clamp,
  getOutputSize,
  meanLuminance,
} from './processing.js';

const SETTINGS_KEY = 'nour-studio-settings-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  video: $('#camera-source'),
  canvas: $('#processed-canvas'),
  placeholder: $('#preview-placeholder'),
  placeholderTitle: $('#placeholder-title'),
  placeholderCopy: $('#placeholder-copy'),
  placeholderStart: $('#placeholder-start'),
  startButton: $('#start-camera-button'),
  cameraSelect: $('#camera-select'),
  cameraState: $('#camera-state'),
  cameraStateText: $('#camera-state-text'),
  cameraResolution: $('#camera-resolution'),
  resolutionPill: $('#resolution-pill'),
  feedLabel: $('#feed-label'),
  outputButton: $('#clean-output-button'),
  mirrorButton: $('#mirror-button'),
  autoLight: $('#auto-light-toggle'),
  exposure: $('#exposure-range'),
  contrast: $('#contrast-range'),
  warmth: $('#warmth-range'),
  exposureValue: $('#exposure-value'),
  contrastValue: $('#contrast-value'),
  warmthValue: $('#warmth-value'),
  reset: $('#reset-adjustments'),
  dialog: $('#guide-dialog'),
  toast: $('#toast'),
  sidebar: $('#sidebar'),
  menuToggle: $('#menu-toggle'),
  sidebarScrim: $('#sidebar-scrim'),
};

const saved = readSettings();
const state = {
  profile: QUALITY_PROFILES[saved.profile] ? saved.profile : 'low',
  exposure: clamp(saved.exposure ?? DEFAULT_ADJUSTMENTS.exposure, -20, 30),
  contrast: clamp(saved.contrast ?? DEFAULT_ADJUSTMENTS.contrast, -20, 30),
  warmth: clamp(saved.warmth ?? DEFAULT_ADJUSTMENTS.warmth, -15, 20),
  autoLight: saved.autoLight ?? DEFAULT_ADJUSTMENTS.autoLight,
  mirror: saved.mirror ?? DEFAULT_ADJUSTMENTS.mirror,
  stream: null,
  animation: 0,
  starting: false,
  lastDraw: 0,
  lastExposureCheck: 0,
  exposureGain: 1,
  lastFpsUpdate: 0,
  frames: 0,
  toastTimer: 0,
};

const context = elements.canvas.getContext('2d', { alpha: false, desynchronized: true });
const analysisCanvas = document.createElement('canvas');
analysisCanvas.width = 48;
analysisCanvas.height = 27;
const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true });

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      profile: state.profile,
      exposure: state.exposure,
      contrast: state.contrast,
      warmth: state.warmth,
      autoLight: state.autoLight,
      mirror: state.mirror,
    }));
  } catch {
    // Storage is optional; the camera preview still works without it.
  }
}

function showToast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle('error', error);
  elements.toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 3800);
}

function updateSlider(input, output, value) {
  const number = Number(value);
  input.value = String(number);
  output.value = number > 0 ? `+${number}` : String(number);
  output.textContent = output.value;
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((number - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to left, #8172d7 ${percent}%, #e8ebe8 ${percent}%)`;
}

function updateSettingsUI() {
  updateSlider(elements.exposure, elements.exposureValue, state.exposure);
  updateSlider(elements.contrast, elements.contrastValue, state.contrast);
  updateSlider(elements.warmth, elements.warmthValue, state.warmth);
  elements.autoLight.classList.toggle('on', state.autoLight);
  elements.autoLight.setAttribute('aria-checked', String(state.autoLight));
  elements.autoLight.setAttribute('aria-label', state.autoLight ? 'إيقاف تصحيح الإضاءة التلقائي' : 'تشغيل تصحيح الإضاءة التلقائي');
  elements.mirrorButton.setAttribute('aria-pressed', String(state.mirror));
  elements.canvas.classList.toggle('mirrored', state.mirror);
  $$('.quality-option').forEach(button => {
    const selected = button.dataset.profile === state.profile;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateProfileLabel();
}

function updateProfileLabel() {
  const profile = QUALITY_PROFILES[state.profile];
  elements.resolutionPill.textContent = `${profile.label} · ${profile.fps} fps`;
}

function updateCameraUI(active) {
  elements.placeholder.hidden = active;
  elements.cameraState.classList.toggle('live', active);
  elements.cameraStateText.textContent = active ? 'الكاميرا خدامة محلياً' : 'الكاميرا مطفّية';
  elements.feedLabel.textContent = active ? 'تحسين محلي شغّال' : 'معاينة محلية';
  elements.startButton.classList.toggle('is-stop', active);
  elements.startButton.hidden = !active;
  elements.startButton.innerHTML = active
    ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg><span>وقف الكاميرا</span>'
    : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg><span>شغّل الكاميرا</span>';
  elements.outputButton.disabled = !active;
  elements.cameraSelect.disabled = !navigator.mediaDevices?.enumerateDevices;
  if (!active) {
    elements.cameraResolution.textContent = 'بانتظار الكاميرا';
    if (context) {
      context.save();
      context.filter = 'none';
      context.fillStyle = '#111719';
      context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
      context.restore();
    }
  }
}

function updateCanvasSize() {
  const videoWidth = elements.video.videoWidth;
  const videoHeight = elements.video.videoHeight;
  if (!videoWidth || !videoHeight) return;
  const size = getOutputSize(videoWidth, videoHeight, state.profile);
  if (elements.canvas.width !== size.width || elements.canvas.height !== size.height) {
    elements.canvas.width = size.width;
    elements.canvas.height = size.height;
  }
  elements.cameraResolution.textContent = `${videoWidth} × ${videoHeight} → ${size.width} × ${size.height}`;
}

async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const current = elements.cameraSelect.value;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === 'videoinput');
    elements.cameraSelect.replaceChildren(new Option('الكاميرا الافتراضية', ''));
    cameras.forEach((camera, index) => {
      const label = camera.label || `كاميرا ${index + 1}`;
      elements.cameraSelect.add(new Option(label, camera.deviceId));
    });
    if (cameras.some(camera => camera.deviceId === current)) elements.cameraSelect.value = current;
  } catch {
    // Device labels may be hidden until permission is granted.
  }
}

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'خاصك تسمح للمتصفح يستعمل الكاميرا. الصورة ما كتترفعش لأي سيرفر.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'ما لقيناش كاميرا. ربط كاميرا وخليها مفعّلة، ومن بعد عاود.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'الكاميرا ممكن تكون محلولة فبرنامج آخر. سدّ داك البرنامج وعاود.';
    case 'OverconstrainedError':
      return 'هاد إعداد الجودة ما كيناسبش الكاميرا. جرّب وضع متوازن.';
    case 'SecurityError':
      return 'المتصفح منع الكاميرا. حلّ التطبيق عبر HTTPS أو localhost.';
    default:
      return 'ما قدرناش نشغّلو الكاميرا. تأكد من الصلاحيات وعاود المحاولة.';
  }
}

async function startCamera() {
  if (state.starting) return;
  if (state.stream) {
    stopCamera();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    const message = 'هاد المتصفح ما كيدعمش الكاميرا هنا. خاص HTTPS أو localhost ومتصفح حديث.';
    elements.placeholderTitle.textContent = 'الكاميرا ما خداماش';
    elements.placeholderCopy.textContent = message;
    showToast(message, true);
    return;
  }

  state.starting = true;
  elements.startButton.disabled = true;
  elements.placeholderStart.disabled = true;
  elements.placeholderTitle.textContent = 'كنطلبو إذن الكاميرا…';
  elements.placeholderCopy.textContent = 'الصورة غاتبقى غير فهاد الجهاز.';
  elements.placeholder.hidden = false;
  const profile = QUALITY_PROFILES[state.profile];
  const videoConstraints = {
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    frameRate: { ideal: profile.fps, max: profile.fps },
  };
  if (elements.cameraSelect.value) videoConstraints.deviceId = { exact: elements.cameraSelect.value };

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    state.stream = stream;
    elements.video.srcObject = stream;
    await elements.video.play();
    await refreshCameras();
    const track = stream.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      if (state.stream === stream) stopCamera();
    }, { once: true });
    state.exposureGain = 1;
    state.lastDraw = 0;
    state.lastExposureCheck = 0;
    state.lastFpsUpdate = 0;
    state.frames = 0;
    updateCameraUI(true);
    updateCanvasSize();
    state.animation = requestAnimationFrame(drawFrame);
    showToast('الكاميرا خدامة. الصورة كتتعالج محلياً فقط.');
  } catch (error) {
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
    elements.video.srcObject = null;
    const message = cameraErrorMessage(error);
    elements.placeholderTitle.textContent = 'ما قدرناش نشغّلو الكاميرا';
    elements.placeholderCopy.textContent = message;
    showToast(message, true);
    updateCameraUI(false);
  } finally {
    state.starting = false;
    elements.startButton.disabled = false;
    elements.placeholderStart.disabled = false;
  }
}

function stopCamera() {
  if (state.animation) cancelAnimationFrame(state.animation);
  state.animation = 0;
  const stream = state.stream;
  state.stream = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  elements.video.pause();
  elements.video.srcObject = null;
  updateCameraUI(false);
}

function sampleAutoExposure(now) {
  if (!state.autoLight || !analysisContext || now - state.lastExposureCheck < 700) return;
  state.lastExposureCheck = now;
  try {
    analysisContext.drawImage(elements.video, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const pixels = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height).data;
    const targetGain = autoLightGain(meanLuminance(pixels));
    // Ease changes to avoid visible brightness pumping as someone moves.
    state.exposureGain += (targetGain - state.exposureGain) * 0.28;
  } catch {
    state.exposureGain = 1;
  }
}

function drawFrame(now) {
  if (!state.stream) return;
  const profile = QUALITY_PROFILES[state.profile];
  const frameInterval = 1000 / profile.fps;
  if (elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - state.lastDraw >= frameInterval) {
    state.lastDraw = now;
    sampleAutoExposure(now);
    updateCanvasSize();
    if (context) {
      context.save();
      context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
      context.filter = buildFilter({
        exposure: state.exposure,
        gain: state.autoLight ? state.exposureGain : 1,
        contrast: state.contrast,
        warmth: state.warmth,
      });
      context.drawImage(elements.video, 0, 0, elements.canvas.width, elements.canvas.height);
      context.restore();
    }
    state.frames++;
    if (now - state.lastFpsUpdate >= 1000) {
      const inputWidth = elements.video.videoWidth;
      const inputHeight = elements.video.videoHeight;
      if (inputWidth && inputHeight) {
        const output = getOutputSize(inputWidth, inputHeight, state.profile);
        elements.cameraResolution.textContent = `${inputWidth} × ${inputHeight} → ${output.width} × ${output.height} · ${Math.min(profile.fps, state.frames)} fps`;
      }
      state.frames = 0;
      state.lastFpsUpdate = now;
    }
  }
  state.animation = requestAnimationFrame(drawFrame);
}

async function chooseProfile(profileId) {
  if (!QUALITY_PROFILES[profileId] || state.profile === profileId) return;
  state.profile = profileId;
  updateProfileLabel();
  updateSettingsUI();
  saveSettings();
  if (state.stream) {
    const profile = QUALITY_PROFILES[profileId];
    const track = state.stream.getVideoTracks()[0];
    try {
      await track?.applyConstraints({
        width: { ideal: profile.width },
        height: { ideal: profile.height },
        frameRate: { ideal: profile.fps, max: profile.fps },
      });
    } catch {
      // The browser may keep the camera's existing size; the canvas still scales it safely.
    }
    updateCanvasSize();
  }
  showToast(`تبدّل الوضع لـ ${QUALITY_PROFILES[profileId].label} · ${QUALITY_PROFILES[profileId].fps} fps.`);
}

async function changeCamera() {
  if (!state.stream) return;
  stopCamera();
  await startCamera();
}

function openGuide() {
  closeSidebar();
  if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
  else elements.dialog.setAttribute('open', '');
}

function closeGuide() {
  if (typeof elements.dialog.close === 'function' && elements.dialog.open) elements.dialog.close();
  else elements.dialog.removeAttribute('open');
}

function openOutputMode() {
  if (!state.stream) {
    showToast('شغّل الكاميرا قبل ما تفتح العرض النظيف.', true);
    return;
  }
  document.body.classList.add('output-mode');
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      showToast('إلا ما دخلش ملء الشاشة، استعمل زر العرض النظيف مرة أخرى أو Esc.');
    });
  }
}

function closeOutputMode() {
  document.body.classList.remove('output-mode');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}

function closeSidebar() {
  elements.sidebar.classList.remove('open');
  elements.sidebarScrim.classList.remove('visible');
  elements.menuToggle.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  const open = !elements.sidebar.classList.contains('open');
  elements.sidebar.classList.toggle('open', open);
  elements.sidebarScrim.classList.toggle('visible', open);
  elements.menuToggle.setAttribute('aria-expanded', String(open));
}

function restoreDefaults() {
  state.exposure = DEFAULT_ADJUSTMENTS.exposure;
  state.contrast = DEFAULT_ADJUSTMENTS.contrast;
  state.warmth = DEFAULT_ADJUSTMENTS.warmth;
  state.autoLight = DEFAULT_ADJUSTMENTS.autoLight;
  state.mirror = DEFAULT_ADJUSTMENTS.mirror;
  state.exposureGain = 1;
  updateSettingsUI();
  saveSettings();
  showToast('رجّعنا إعدادات الصورة للوضع الطبيعي.');
}

function bindEvents() {
  elements.startButton.addEventListener('click', startCamera);
  elements.placeholderStart.addEventListener('click', startCamera);
  elements.cameraSelect.addEventListener('change', changeCamera);
  elements.outputButton.addEventListener('click', openOutputMode);
  elements.mirrorButton.addEventListener('click', () => {
    state.mirror = !state.mirror;
    updateSettingsUI();
    saveSettings();
  });
  elements.autoLight.addEventListener('click', () => {
    state.autoLight = !state.autoLight;
    if (!state.autoLight) state.exposureGain = 1;
    updateSettingsUI();
    saveSettings();
  });
  elements.exposure.addEventListener('input', event => {
    state.exposure = Number(event.currentTarget.value);
    updateSlider(elements.exposure, elements.exposureValue, state.exposure);
    saveSettings();
  });
  elements.contrast.addEventListener('input', event => {
    state.contrast = Number(event.currentTarget.value);
    updateSlider(elements.contrast, elements.contrastValue, state.contrast);
    saveSettings();
  });
  elements.warmth.addEventListener('input', event => {
    state.warmth = Number(event.currentTarget.value);
    updateSlider(elements.warmth, elements.warmthValue, state.warmth);
    saveSettings();
  });
  elements.reset.addEventListener('click', restoreDefaults);
  $$('.quality-option').forEach(button => button.addEventListener('click', () => chooseProfile(button.dataset.profile)));
  ['#nav-guide', '#top-guide', '#bottom-guide'].forEach(selector => $(selector).addEventListener('click', openGuide));
  $('#close-guide').addEventListener('click', closeGuide);
  $('#done-guide').addEventListener('click', closeGuide);
  elements.dialog.addEventListener('click', event => {
    if (event.target === elements.dialog) closeGuide();
  });
  elements.menuToggle.addEventListener('click', toggleSidebar);
  elements.sidebarScrim.addEventListener('click', closeSidebar);
  elements.sidebar.addEventListener('click', event => {
    if (event.target.closest('a[href="#studio"]')) closeSidebar();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('output-mode')) closeOutputMode();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && document.body.classList.contains('output-mode')) document.body.classList.remove('output-mode');
  });
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.stream) {
      state.lastDraw = 0;
      state.animation ||= requestAnimationFrame(drawFrame);
    }
  });
}

updateSettingsUI();
updateCameraUI(false);
bindEvents();
refreshCameras();

if ('serviceWorker' in navigator && location.hostname !== 'appassets.androidplatform.net' && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
