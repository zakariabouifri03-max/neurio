const DEFAULT_SETTINGS = Object.freeze({
  smartBufferProtection: true,
  maximumSmoothness: false,
  resumeBufferSeconds: 8
});

const smartToggle = document.getElementById('smart-protection');
const maximumToggle = document.getElementById('maximum-smoothness');
const resumeTarget = document.getElementById('resume-target');
const resumeValue = document.getElementById('resume-value');
const reserveSetting = document.getElementById('reserve-setting');
const effectiveTarget = document.getElementById('effective-target');
const modeSuffix = document.getElementById('mode-suffix');
const saveState = document.getElementById('save-state');
const saveLabel = document.getElementById('save-label');

let settings = { ...DEFAULT_SETTINGS };
let saveTimer = null;

function normalizeSettings(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const target = Number(candidate.resumeBufferSeconds);
  return {
    smartBufferProtection: typeof candidate.smartBufferProtection === 'boolean'
      ? candidate.smartBufferProtection
      : DEFAULT_SETTINGS.smartBufferProtection,
    maximumSmoothness: typeof candidate.maximumSmoothness === 'boolean'
      ? candidate.maximumSmoothness
      : DEFAULT_SETTINGS.maximumSmoothness,
    resumeBufferSeconds: Number.isFinite(target)
      ? Math.min(18, Math.max(6, Math.round(target / 2) * 2))
      : DEFAULT_SETTINGS.resumeBufferSeconds
  };
}

function render() {
  smartToggle.checked = settings.smartBufferProtection;
  maximumToggle.checked = settings.maximumSmoothness;
  resumeTarget.value = String(settings.resumeBufferSeconds);
  reserveSetting.classList.toggle('is-disabled', !settings.smartBufferProtection);
  resumeTarget.disabled = !settings.smartBufferProtection;

  const effectiveSeconds = settings.resumeBufferSeconds + (settings.maximumSmoothness ? 6 : 0);
  effectiveTarget.textContent = `${effectiveSeconds} seconds`;
  modeSuffix.textContent = settings.maximumSmoothness
    ? ' of buffered video in Maximum Smoothness Mode.'
    : ' of buffered video.';
  resumeValue.textContent = `${settings.resumeBufferSeconds} sec`;
}

function showSaveState(state) {
  const text = state === 'saving' ? 'Saving…' : state === 'error' ? 'Could not save' : 'Saved on this device';
  saveLabel.textContent = text;
  saveState.classList.toggle('is-error', state === 'error');
}

async function persistSettings() {
  showSaveState('saving');
  try {
    await chrome.storage.local.set({ settings });
    showSaveState('saved');
  } catch (error) {
    console.warn('[YouTube Smooth 1080p] Could not save settings.', error);
    showSaveState('error');
  }
}

function scheduleSave() {
  settings = normalizeSettings(settings);
  render();
  showSaveState('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistSettings();
  }, 180);
}

smartToggle.addEventListener('change', () => {
  settings.smartBufferProtection = smartToggle.checked;
  scheduleSave();
});

maximumToggle.addEventListener('change', () => {
  settings.maximumSmoothness = maximumToggle.checked;
  scheduleSave();
});

resumeTarget.addEventListener('input', () => {
  settings.resumeBufferSeconds = Number(resumeTarget.value);
  scheduleSave();
});

chrome.storage.local.get('settings').then(({ settings: stored }) => {
  settings = normalizeSettings(stored);
  render();
  showSaveState('saved');
}).catch((error) => {
  console.warn('[YouTube Smooth 1080p] Could not load settings.', error);
  render();
  showSaveState('error');
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.settings || saveTimer) return;
  settings = normalizeSettings(changes.settings.newValue);
  render();
});
