const DEFAULT_SETTINGS = Object.freeze({
  smartBufferProtection: true,
  maximumSmoothness: false,
  resumeBufferSeconds: 8
});

const ui = {
  liveBadge: document.getElementById('live-badge'),
  liveLabel: document.getElementById('live-label'),
  pageChip: document.getElementById('page-chip'),
  quality: document.getElementById('quality-value'),
  qualityFoot: document.getElementById('quality-foot'),
  connection: document.getElementById('connection-value'),
  connectionFoot: document.getElementById('connection-foot'),
  speed: document.getElementById('speed-value'),
  speedFoot: document.getElementById('speed-foot'),
  buffer: document.getElementById('buffer-value'),
  playback: document.getElementById('playback-value'),
  playbackNote: document.getElementById('playback-note'),
  playbackSymbol: document.getElementById('playback-symbol'),
  pageMessage: document.getElementById('page-message'),
  smartToggle: document.getElementById('smart-toggle'),
  maximumToggle: document.getElementById('maximum-toggle'),
  settingsButton: document.getElementById('settings-button')
};

let settings = { ...DEFAULT_SETTINGS };
let currentTabId = null;
let currentPageActive = false;
let refreshing = false;

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

function formatSeconds(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 10) return `${value.toFixed(1)}s`;
  return `${Math.round(value)}s`;
}

function formatMbps(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Unavailable';
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} Mbps`;
}

function setSwitch(button, enabled) {
  button.setAttribute('aria-checked', String(Boolean(enabled)));
}

function renderSettings() {
  setSwitch(ui.smartToggle, settings.smartBufferProtection);
  setSwitch(ui.maximumToggle, settings.maximumSmoothness);
}

function setLiveState(state, label) {
  ui.liveBadge.classList.toggle('is-active', state === 'active');
  ui.liveBadge.classList.toggle('is-waiting', state === 'waiting');
  ui.liveLabel.textContent = label;
}

function clearPlayerValues() {
  ui.quality.textContent = '—';
  ui.qualityFoot.textContent = 'Read from player';
  ui.connection.textContent = '—';
  ui.connectionFoot.textContent = 'Network estimate';
  ui.speed.textContent = 'Unavailable';
  ui.speedFoot.textContent = 'Not exposed by this browser';
  ui.buffer.textContent = '—';
  ui.playback.textContent = 'Waiting for YouTube';
  ui.playbackNote.textContent = 'Monitoring only';
  ui.playbackSymbol.classList.remove('is-buffering', 'is-paused');
}

function renderStatus(status) {
  if (!status || !status.pageActive) {
    currentPageActive = false;
    setLiveState('idle', 'Not active');
    ui.pageChip.textContent = 'Inactive';
    ui.pageMessage.textContent = 'Open youtube.com to monitor a watch page or Short.';
    clearPlayerValues();
    return;
  }

  currentPageActive = true;
  const hasVideo = Boolean(status.videoFound);
  setLiveState(hasVideo ? 'active' : 'waiting', hasVideo ? 'Active' : 'Waiting');
  ui.pageChip.textContent = status.pageType || 'YouTube';

  if (!hasVideo) {
    clearPlayerValues();
    ui.playback.textContent = 'Waiting for player';
    ui.pageMessage.textContent = 'YouTube is open. Live measurements appear when its video player is ready.';
    return;
  }

  const quality = status.quality || {};
  ui.quality.textContent = quality.label || 'Unavailable';
  ui.qualityFoot.textContent = quality.source === 'player-api'
    ? 'YouTube player report'
    : quality.source === 'video-dimensions'
      ? 'Current video dimensions'
      : 'Not exposed by player';

  const connection = status.connection || {};
  ui.connection.textContent = connection.label || 'Unknown';
  ui.connectionFoot.textContent = connection.source === 'network-information-api'
    ? 'Chrome network estimate'
    : connection.source === 'playback-observation'
      ? 'Inferred from buffer and stalls'
      : 'Not exposed by this browser';
  ui.connection.className = 'metric-value';
  if (connection.label === 'Slow') ui.connection.style.color = 'var(--amber)';
  else if (connection.label === 'Fast') ui.connection.style.color = 'var(--green)';
  else if (connection.label === 'Medium') ui.connection.style.color = '#a8d9ff';
  else ui.connection.style.color = '';

  const speed = status.connection && status.connection.downlinkMbps;
  ui.speed.textContent = formatMbps(speed);
  ui.speedFoot.textContent = Number.isFinite(speed) && speed > 0
    ? 'Chrome network estimate · not a test'
    : 'Not exposed by this browser';

  ui.buffer.textContent = Number.isFinite(status.bufferSeconds)
    ? formatSeconds(status.bufferSeconds)
    : '—';

  const playback = status.playback || {};
  const playbackLabels = {
    stable: 'Stable',
    buffering: 'Buffering',
    building: 'Building buffer',
    paused: 'Paused',
    seeking: 'Seeking',
    ended: 'Ended',
    unavailable: 'Monitoring'
  };
  const state = playback.state || 'unavailable';
  ui.playback.textContent = playbackLabels[state] || 'Monitoring';
  ui.playbackNote.textContent = playback.protectionPaused
    ? 'Protection will resume automatically'
    : state === 'stable'
      ? 'No stream changes made'
      : state === 'paused'
        ? 'Paused by viewer'
        : 'Watching buffer health';
  ui.playbackSymbol.classList.toggle('is-buffering', state === 'buffering' || state === 'building');
  ui.playbackSymbol.classList.toggle('is-paused', state === 'paused' || state === 'ended');

  if (status.protectionPaused) {
    ui.pageMessage.textContent = 'Smart Buffer Protection is holding playback briefly while the player builds a buffer.';
  } else if (status.pageType === 'YouTube Shorts') {
    ui.pageMessage.textContent = 'Shorts are monitored where YouTube exposes a standard video element.';
  } else {
    ui.pageMessage.textContent = 'Quality is read-only here: this extension never changes your selection.';
  }
}

async function getCurrentTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs.length ? tabs[0].id : null;
  } catch (_error) {
    return null;
  }
}

async function sendSettingsToTab() {
  if (currentTabId == null) return;
  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'YS1080_SET_SETTINGS', settings });
  } catch (_error) {
    // The active tab may not be a YouTube page, or it may predate extension install.
  }
}

async function refreshStatus() {
  if (refreshing) return;
  refreshing = true;
  try {
    const tabId = await getCurrentTabId();
    currentTabId = tabId;
    if (tabId == null) {
      renderStatus(null);
      return;
    }

    let status = null;
    try {
      status = await chrome.tabs.sendMessage(tabId, { type: 'YS1080_GET_STATUS' });
    } catch (_error) {
      // No content script means this is not a supported page (or the tab needs refresh).
    }
    renderStatus(status);
  } finally {
    refreshing = false;
  }
}

async function saveSettings(nextSettings) {
  settings = normalizeSettings(nextSettings);
  renderSettings();
  try {
    await chrome.storage.local.set({ settings });
  } catch (error) {
    console.warn('[YouTube Smooth 1080p] Could not save settings.', error);
  }
  await sendSettingsToTab();
}

ui.smartToggle.addEventListener('click', () => {
  void saveSettings({ ...settings, smartBufferProtection: !settings.smartBufferProtection });
});

ui.maximumToggle.addEventListener('click', () => {
  void saveSettings({ ...settings, maximumSmoothness: !settings.maximumSmoothness });
});

ui.settingsButton.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

chrome.storage.local.get('settings').then(({ settings: stored }) => {
  settings = normalizeSettings(stored);
  renderSettings();
  void sendSettingsToTab();
}).catch(() => renderSettings());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    renderSettings();
  }
});

void refreshStatus();
const refreshTimer = window.setInterval(() => void refreshStatus(), 1500);
window.addEventListener('unload', () => window.clearInterval(refreshTimer), { once: true });
