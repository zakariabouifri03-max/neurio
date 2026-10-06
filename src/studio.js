import { addAssetToTimeline, addMediaAsset, cloneProject, createProject, getAllClips, getAssetById, getTimelineDuration, makeId, splitClip, validateProject } from './editor/project.js';
import { ProjectStore } from './editor/store.js';
import { loadLastProject, removeCachedMediaBlob, restoreCachedAssetUrls, safeName, saveLastProject } from './editor/storage.js';
import { chooseExportPath, getAssetUrl, getBackendStatus, importPickedMedia, isDesktopApp, listenNative, nativeBridge, persistProject, pickMediaFiles, pickModelOrRuntimeFile, readProjectSelection, setModelFile, invokeNative } from './editor/platform.js';
import { applyPlan, directCommandResult, prepareCommand, refreshAIModels } from './editor/commands.js';
import { escapeHtml, formatBytes, formatDuration, formatTime } from './editor/time.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  store: null,
  objectUrls: new Map(),
  selectedClipId: null,
  playhead: 0,
  playing: false,
  playClock: 0,
  pixelsPerSecond: 54,
  currentVideoClipId: null,
  previewAudioPlayers: new Map(),
  projectPath: null,
  backend: { desktop: false, ffmpeg: false, ffprobe: false },
  models: { desktop: false, llm: { installed: false }, whisper: { installed: false }, vision: { installed: false } },
  pendingPlan: null,
  messages: [],
  logs: [],
  modal: null,
  renderProgress: null,
  renderUnlisten: null,
  progressUnlisten: null,
  downloadToast: null,
  autoSaveTimer: null,
  animationFrame: null,
  lastPreviewPaint: 0,
};

const ICONS = {
  play: '<path d="m9 6 10 6-10 6z"/>', pause: '<path d="M8 6v12M16 6v12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-7h10v7"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14h-2"/>',
  redo: '<path d="m15 14 5-5-5-5m5 5h-9a7 7 0 0 0 0 14h2"/>',
  export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v4h14v-4"/>',
  wave: '<path d="M3 12h2l2-7 4 14 4-14 2 7h4"/>',
  spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7.5 10.5h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/>',
};

function icon(name, size = 16) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

function renderShell() {
  $('#app').innerHTML = `
    <div class="studio-shell">
      <header class="topbar">
        <div class="brand-lockup"><div class="brand-mark">N</div><div><b>NEXUS <span>VIDEO STUDIO</span></b><small>OFFLINE EDITING WORKSPACE</small></div></div>
        <div class="top-project-tools">
          <button class="top-tool" id="newProjectBtn" title="New project">New</button>
          <button class="top-tool" id="openProjectBtn" title="Open project">Open</button>
          <button class="top-tool" id="saveProjectBtn" title="Save project">${icon('save', 15)}<span>Save</span></button>
          <span class="top-divider"></span>
          <button class="icon-button" id="undoBtn" title="Undo (Ctrl+Z)">${icon('undo')}</button>
          <button class="icon-button" id="redoBtn" title="Redo (Ctrl+Y)">${icon('redo')}</button>
        </div>
        <div class="top-project-name"><span class="status-dot"></span><input id="projectName" aria-label="Project name" value="Untitled Project" /><span id="saveStatus" class="save-status">LOCAL</span></div>
        <div class="top-actions">
          <button class="icon-button" id="modelManagerBtn" title="AI Model Manager">${icon('spark')}<span class="button-label">Models</span></button>
          <button class="icon-button" id="logsBtn" title="Open logs">LOG</button>
          <button class="export-button" id="exportBtn">${icon('export', 16)}<span>Export</span></button>
        </div>
      </header>

      <div class="studio-grid">
        <aside class="media-sidebar">
          <div class="panel-heading"><div><span class="eyebrow">PROJECT</span><h2>Media</h2></div><button class="icon-button compact" id="importButton" title="Import media">${icon('plus', 17)}</button></div>
          <button class="import-drop" id="importDrop" type="button"><span class="drop-icon">${icon('folder', 20)}</span><b>Import media</b><small>Video, audio, images · drop files here</small></button>
          <div class="media-filter"><span>PROJECT BIN</span><span id="assetCount">0 ITEMS</span></div>
          <div id="assetList" class="asset-list"><div class="empty-bin">Your imported media<br>will appear here.</div></div>
          <div class="sidebar-footer">
            <div class="footer-status"><span class="status-pulse"></span><div><b>Offline-first</b><small>No external AI API</small></div></div>
            <button class="sidebar-link" id="analysisButton">${icon('wave', 15)} Analyze media <span id="analysisCount" class="tiny-count"></span></button>
          </div>
        </aside>

        <main class="editor-main">
          <section class="preview-panel">
            <div class="section-toolbar preview-toolbar">
              <div class="view-tabs"><button class="view-tab active">Program</button><span class="preview-separator">/</span><span class="muted-text">Source preview</span></div>
              <div class="preview-meta"><span id="sequenceBadge">1920 × 1080 · 30 FPS</span><span class="meta-separator"></span><span id="previewTimecode">00:00:00:00</span></div>
            </div>
            <div class="preview-stage-wrap">
              <div class="preview-stage" id="previewStage">
                <video id="previewVideo" playsinline preload="metadata"></video>
                <img id="previewImage" alt="Timeline still image" hidden />
                <div class="preview-empty" id="previewEmpty"><div class="empty-emblem">N</div><b>Nothing on the timeline yet</b><span>Import a video or drag media onto a track.</span><button id="emptyImportButton" class="secondary-button">${icon('plus', 15)} Import media</button></div>
                <div class="preview-caption" id="previewCaption" hidden></div>
                <div class="preview-waterline"><span><i></i> PROGRAM</span><span id="previewResolution">NO SIGNAL</span></div>
              </div>
            </div>
            <div class="transport-bar">
              <div class="transport-left"><button id="splitButton" class="transport-action" title="Split selected clip at playhead">SPLIT</button><span class="transport-divider"></span><button id="deleteClipButton" class="transport-action danger-text" title="Delete selected clip">DELETE</button></div>
              <div class="transport-center"><button id="stepBackButton" class="step-button" title="Previous frame">‹</button><button id="playButton" class="play-button" title="Play / pause">${icon('play', 18)}</button><button id="stepForwardButton" class="step-button" title="Next frame">›</button><span class="time-readout" id="transportTime">00:00:00:00</span></div>
              <div class="transport-right"><span id="playbackNotice">REAL-TIME PREVIEW</span></div>
            </div>
          </section>

        </main>

        <aside class="assistant-panel">
          <div class="assistant-heading"><div class="assistant-icon">${icon('spark', 18)}</div><div><h2>AI Assistant</h2><small><span class="offline-dot"></span> LOCAL TOOL AGENT</small></div><button class="icon-button compact assistant-menu" id="assistantModelsShortcut" title="AI Model Manager">${icon('settings', 15)}</button></div>
          <div class="assistant-state" id="assistantState"></div>
          <div class="conversation" id="conversation"></div>
          <div id="pendingPlan" class="pending-plan" hidden></div>
          <form id="commandForm" class="command-composer">
            <label for="commandInput" class="composer-label">TELL THE EDITOR</label>
            <textarea id="commandInput" rows="3" placeholder="Try “Remove the first 4 seconds”" aria-label="Natural language editing command"></textarea>
            <div class="composer-footer"><span>Local tools only <span class="tip-dot">·</span> Enter to send</span><button class="send-command" type="submit" aria-label="Run editing command">${icon('play', 14)}</button></div>
          </form>
          <div class="assistant-disclaimer">Commands modify a reversible project timeline. Original files are never overwritten.</div>
        </aside>

        <section class="timeline-dock" aria-label="Timeline tracks">
          <div class="dock-head"><div class="dock-title"><span class="eyebrow">SEQUENCE</span><b>Tracks &amp; clips</b><span class="duration-pill" id="durationPill">00:00</span></div><div class="dock-controls"><button class="tool-button" id="addTrackButton" title="Add a track">${icon('plus', 13)} Track</button><span class="dock-divider"></span><button class="icon-button compact" id="zoomOutButton" title="Zoom out">${icon('zoomOut', 14)}</button><input id="timelineZoom" type="range" min="20" max="140" value="54" aria-label="Timeline zoom"><button class="icon-button compact" id="zoomInButton" title="Zoom in">${icon('zoomIn', 14)}</button><span class="dock-divider"></span><span id="selectionInfo">No clip selected</span><span class="dock-divider"></span><span id="trackCount">3 TRACKS</span></div></div>
          <div id="timelineLabelsDock" class="timeline-labels-dock"></div>
          <div class="timeline-scroll dock-scroll" id="timelineScrollDock"><div id="timelineContentDock" class="timeline-content"></div></div>
          <div class="timeline-footer dock-footer"><span><kbd>Space</kbd> Play/Pause <span class="dot-sep">·</span> <kbd>Ctrl Z</kbd> Undo/Redo <span class="dot-sep">·</span> Drag clips to move</span><span id="timelineHintDock">NON-DESTRUCTIVE EDITS</span></div>
        </section>
      </div>
      <div id="modalRoot"></div>
      <div id="toastRoot" class="toast-root"></div>
    </div>`;
}

function addLog(level, message, detail = '') {
  const entry = { time: new Date().toISOString(), level, message: String(message), detail: detail ? String(detail) : '' };
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 500);
  if (level === 'error') console.error('[Nexus]', message, detail);
}

function toast(message, kind = 'success', detail = '') {
  const root = $('#toastRoot');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.innerHTML = `<span class="toast-symbol">${kind === 'error' ? '!' : kind === 'warning' ? '•' : '✓'}</span><div><b>${escapeHtml(message)}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
  root.append(item);
  setTimeout(() => item.remove(), 4300);
}

function updateModelDownloadNotice(payload) {
  const root = $('#toastRoot');
  if (!root) return;
  if (!state.downloadToast || !state.downloadToast.isConnected) {
    const item = document.createElement('div');
    item.className = 'toast toast-info model-download-toast';
    item.id = 'modelDownloadToast';
    root.append(item);
    state.downloadToast = item;
  }
  const percent = Math.max(0, Math.min(100, Math.round(Number(payload.percent) || 0)));
  const sizes = `${formatBytes(payload.downloaded ?? 0)}${payload.total ? ` / ${formatBytes(payload.total)}` : ''}`;
  state.downloadToast.innerHTML = `<span class="toast-symbol">↓</span><div><b>${payload.completed ? 'Model download complete' : `Downloading local model · ${percent}%`}</b><small>${escapeHtml(payload.modelId ?? '')} · ${escapeHtml(sizes)}</small><div class="download-toast-track"><i style="width:${percent}%"></i></div></div>`;
  if (payload.completed) setTimeout(() => { state.downloadToast?.remove(); state.downloadToast = null; }, 4500);
}

function setSaveStatus(value = 'LOCAL') {
  const element = $('#saveStatus');
  if (element) element.textContent = value;
}

function scheduleAutosave() {
  clearTimeout(state.autoSaveTimer);
  setSaveStatus('SAVING');
  state.autoSaveTimer = setTimeout(async () => {
    const result = await saveLastProject(state.store.project);
    setSaveStatus(result ? 'LOCAL' : 'NOT SAVED');
  }, 300);
}

function escapeClipName(asset) { return escapeHtml(asset?.name ?? 'Missing source'); }

function renderAssetList() {
  const container = $('#assetList');
  const project = state.store.project;
  $('#assetCount').textContent = `${project.assets.length} ITEM${project.assets.length === 1 ? '' : 'S'}`;
  const analyses = Object.keys(project.analysis?.byAsset ?? {}).length;
  $('#analysisCount').textContent = analyses ? analyses : '';
  if (!project.assets.length) {
    container.innerHTML = '<div class="empty-bin">Your imported media<br>will appear here.</div>';
    return;
  }
  const timelineAssets = new Set(getAllClips(project).map((clip) => clip.assetId));
  container.innerHTML = project.assets.map((asset) => {
    const mediaIcon = asset.mediaType === 'audio' ? '♫' : asset.mediaType === 'image' ? '▧' : '▰';
    const meta = asset.mediaType === 'image' ? `${asset.width} × ${asset.height}` : `${formatDuration(asset.duration)}${asset.width ? ` · ${asset.width}×${asset.height}` : ''}`;
    const unavailable = asset.missing || (!asset.path && !state.objectUrls.has(asset.id));
    return `<article class="asset-row ${unavailable ? 'asset-missing' : ''}" draggable="true" data-asset-id="${escapeHtml(asset.id)}" title="Drag to a timeline track">
      <div class="asset-thumb ${asset.mediaType}"><span>${mediaIcon}</span></div><div class="asset-copy"><b>${escapeClipName(asset)}</b><small>${escapeHtml(meta)}${asset.size ? ` · ${formatBytes(asset.size)}` : ''}</small>${unavailable ? '<em>Source unavailable — relink media</em>' : ''}</div>
      ${unavailable ? `<button class="asset-add relink-action" data-relink-asset="${escapeHtml(asset.id)}" title="Relink source media">↻</button>` : `<button class="asset-add" data-add-asset="${escapeHtml(asset.id)}" title="Add to timeline">${timelineAssets.has(asset.id) ? '↗' : '+'}</button>`}
    </article>`;
  }).join('');
  $$('.asset-row').forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('application/x-nexus-asset', row.dataset.assetId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    });
  });
  $$('[data-add-asset]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation(); addAssetFromBin(button.dataset.addAsset);
  }));
  $$('[data-relink-asset]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation(); relinkMedia(button.dataset.relinkAsset);
  }));
}

function getClipScaleAt(clip, localTime) {
  const keys = (clip.keyframes ?? []).filter((key) => key.property === 'scale').sort((a, b) => a.time - b.time);
  if (!keys.length) return Number(clip.transform?.scale) || 1;
  if (localTime <= keys[0].time) return keys[0].value;
  for (let index = 1; index < keys.length; index++) {
    const previous = keys[index - 1];
    const current = keys[index];
    if (localTime <= current.time) {
      const span = current.time - previous.time || 1;
      const progress = Math.max(0, Math.min(1, (localTime - previous.time) / span));
      return previous.value + (current.value - previous.value) * progress;
    }
  }
  return keys.at(-1).value;
}

function getActiveClip(time, type) {
  const tracks = state.store.project.tracks.filter((track) => track.type === type && (type !== 'audio' || !track.muted) && track.visible !== false);
  for (const track of tracks) {
    const clip = track.clips.find((item) => time >= item.startTime && time < item.startTime + item.duration);
    if (clip) return { clip, track };
  }
  return null;
}

function setVideoSource(asset, clip, timelineTime) {
  const video = $('#previewVideo');
  const source = getAssetUrl(asset, state.objectUrls);
  if (!source) return false;
  if (state.currentVideoClipId !== clip.id || video.dataset.src !== source) {
    state.currentVideoClipId = clip.id;
    video.dataset.src = source;
    video.src = source;
    video.load();
    const target = Math.max(0, (Number(clip.sourceIn) || 0) + timelineTime - clip.startTime);
    video.addEventListener('loadedmetadata', function onMeta() {
      video.removeEventListener('loadedmetadata', onMeta);
      try { video.currentTime = Math.min(target, Math.max(0, video.duration - 0.02)); } catch { /* WebView seeks after metadata on the next preview tick. */ }
      if (state.playing) video.play().catch(() => {});
    }, { once: true });
  } else {
    const desired = (Number(clip.sourceIn) || 0) + timelineTime - clip.startTime;
    if (Number.isFinite(desired) && Math.abs(video.currentTime - desired) > 0.45 && video.readyState >= 1) {
      try { video.currentTime = Math.max(0, Math.min(desired, video.duration - 0.02)); } catch { /* not seekable yet */ }
    }
  }
  const localTime = timelineTime - clip.startTime;
  const scale = getClipScaleAt(clip, localTime);
  video.style.transform = `scale(${Math.max(1, Math.min(2.5, scale))})`;
  video.volume = Math.max(0, Math.min(1, Number(clip.volume) || 1));
  return true;
}

function syncPreviewAudio(time) {
  const project = state.store.project;
  const activeIds = new Set();
  for (const track of project.tracks) {
    if (!['video', 'audio'].includes(track.type) || track.muted || track.visible === false) continue;
    for (const clip of track.clips) {
      if (time < clip.startTime || time >= clip.startTime + clip.duration) continue;
      const asset = getAssetById(project, clip.assetId);
      if (!asset?.hasAudio || asset.mediaType === 'image') continue;
      const source = getAssetUrl(asset, state.objectUrls);
      if (!source) continue;
      activeIds.add(clip.id);
      let player = state.previewAudioPlayers.get(clip.id);
      if (!player || player.source !== source) {
        if (player) { player.element.pause(); player.element.removeAttribute('src'); player.element.load(); }
        const element = document.createElement('audio');
        element.preload = 'metadata';
        player = { element, source, targetTime: 0 };
        state.previewAudioPlayers.set(clip.id, player);
        element.addEventListener('loadedmetadata', () => {
          if (state.previewAudioPlayers.get(clip.id) !== player) return;
          try { element.currentTime = Math.max(0, player.targetTime); } catch { /* the next preview tick retries */ }
          if (state.playing) element.play().catch(() => {});
        });
        element.addEventListener('error', () => addLog('warning', 'A timeline audio source could not be decoded.', asset.name));
        element.src = source;
        element.load();
      }
      const element = player.element;
      const desired = Math.max(0, (Number(clip.sourceIn) || 0) + time - clip.startTime);
      player.targetTime = desired;
      const clipVolume = Number(clip.volume);
      element.volume = Math.max(0, Math.min(1, Number.isFinite(clipVolume) ? clipVolume : 1));
      if (element.readyState >= 1 && Number.isFinite(element.currentTime) && Math.abs(element.currentTime - desired) > 0.35) {
        try { element.currentTime = desired; } catch { /* the media element may not be seekable yet */ }
      }
      if (state.playing && element.readyState >= 2 && element.paused) element.play().catch(() => {});
      else if (!state.playing) element.pause();
    }
  }
  for (const [clipId, player] of state.previewAudioPlayers) {
    if (activeIds.has(clipId)) continue;
    player.element.pause();
    player.element.removeAttribute('src');
    player.element.load();
    state.previewAudioPlayers.delete(clipId);
  }
}

function updatePreview(time = state.playhead) {
  const project = state.store.project;
  const activeVideo = getActiveClip(time, 'video');
  const video = $('#previewVideo');
  const image = $('#previewImage');
  const empty = $('#previewEmpty');
  const stage = $('#previewStage');
  const clip = activeVideo?.clip;
  const asset = clip ? getAssetById(project, clip.assetId) : null;
  let showingMedia = false;
  if (clip && asset?.mediaType === 'image') {
    const source = getAssetUrl(asset, state.objectUrls);
    if (source) {
      video.pause(); video.hidden = true; state.currentVideoClipId = null;
      if (image.dataset.src !== source) { image.dataset.src = source; image.src = source; }
      image.hidden = false;
      image.style.transform = `scale(${Math.max(1, Math.min(2.5, getClipScaleAt(clip, time - clip.startTime)))})`;
      showingMedia = true;
    }
  } else if (clip && asset && setVideoSource(asset, clip, time)) {
    video.hidden = false; image.hidden = true;
    showingMedia = true;
    video.muted = true;
    if (state.playing && video.paused && video.readyState >= 2) video.play().catch(() => {});
  } else {
    video.pause(); video.hidden = true; image.hidden = true;
    state.currentVideoClipId = null;
  }
  empty.hidden = showingMedia;
  stage.classList.toggle('has-media', showingMedia);
  syncPreviewAudio(time);
  const captionTrack = project.tracks.find((track) => track.type === 'caption' && !track.muted && track.visible !== false);
  const caption = captionTrack?.clips.find((item) => time >= item.startTime && time < item.startTime + item.duration);
  const captionEl = $('#previewCaption');
  if (caption) {
    captionEl.hidden = false;
    captionEl.textContent = caption.text;
    captionEl.style.fontSize = `${Math.max(15, Math.min(56, Number(caption.style?.fontSize) || 30))}px`;
    captionEl.classList.toggle('caption-raised', caption.style?.position === 'mid-lower');
  } else captionEl.hidden = true;
  const ratio = project.settings.aspectRatio || '16:9';
  stage.style.setProperty('--aspect', ratio.replace(':', ' / '));
  const width = project.settings.width;
  const height = project.settings.height;
  $('#previewResolution').textContent = clip ? `${width} × ${height}` : 'NO SIGNAL';
  $('#sequenceBadge').textContent = `${width} × ${height} · ${project.settings.fps} FPS`;
  $('#previewTimecode').textContent = formatTime(time, project.settings.fps, true);
  $('#transportTime').textContent = formatTime(time, project.settings.fps, true);
  $('#durationPill').textContent = formatTime(getTimelineDuration(project));
  const selection = state.selectedClipId ? getAllClips(project).find((item) => item.id === state.selectedClipId) : null;
  $('#selectionInfo').textContent = selection ? `${getAssetById(project, selection.assetId)?.name ?? selection.text ?? 'Clip'} · ${formatTime(selection.duration)}` : 'No clip selected';
  updatePlayheadPaint(time);
}

function updatePlayheadPaint(time) {
  const left = Math.max(0, time * state.pixelsPerSecond);
  for (const line of $$('.playhead-line')) line.style.left = `${left}px`;
  for (const head of $$('.playhead-handle')) head.style.left = `${left}px`;
}

function renderTrackLabels(tracks) {
  return `<div class="timeline-ruler-spacer"></div>${tracks.map((track) => `<div class="track-label ${track.type}-label" data-track-label="${escapeHtml(track.id)}"><div class="track-type-icon">${track.type === 'video' ? 'V' : track.type === 'audio' ? 'A' : 'CC'}</div><div class="track-name"><b>${escapeHtml(track.name)}</b><small>${track.type.toUpperCase()}</small></div><div class="track-controls"><button class="track-toggle ${track.muted ? 'is-off' : ''}" data-track-mute="${escapeHtml(track.id)}" title="${track.muted ? 'Unmute' : 'Mute'}">${track.type === 'video' ? '◉' : track.type === 'audio' ? '◖' : 'CC'}</button><button class="track-toggle ${track.visible === false ? 'is-off' : ''}" data-track-visible="${escapeHtml(track.id)}" title="${track.visible === false ? 'Show' : 'Hide'}">${track.type === 'video' ? '◉' : '◌'}</button><button class="track-toggle ${track.locked ? 'is-locked' : ''}" data-track-lock="${escapeHtml(track.id)}" title="${track.locked ? 'Unlock track' : 'Lock track'}">${track.locked ? '▣' : '▢'}</button></div></div>`).join('')}`;
}

function renderTimelineContent() {
  const project = state.store.project;
  const duration = getTimelineDuration(project);
  const pps = state.pixelsPerSecond;
  const width = Math.max(900, (duration + 12) * pps);
  const rulerStep = pps > 85 ? 1 : pps > 44 ? 2 : 5;
  const tickCount = Math.ceil((duration + 8) / rulerStep);
  const ruler = `<div class="timeline-ruler">${Array.from({ length: tickCount + 1 }, (_, index) => {
    const time = index * rulerStep;
    return `<div class="ruler-tick" style="left:${time * pps}px"><i></i><span>${formatTime(time)}</span></div>`;
  }).join('')}</div>`;
  const lanes = project.tracks.map((track) => `<div class="track-lane ${track.type}-lane ${track.muted ? 'track-muted' : ''}" data-track-id="${escapeHtml(track.id)}">
    ${track.clips.map((clip) => {
      const asset = clip.assetId ? getAssetById(project, clip.assetId) : null;
      const isCaption = track.type === 'caption';
      const title = isCaption ? clip.text : asset?.name ?? 'Missing source';
      const durationLabel = formatTime(clip.duration, project.settings.fps, true);
      return `<div class="timeline-clip ${track.type}-clip ${state.selectedClipId === clip.id ? 'selected' : ''}" data-clip-id="${escapeHtml(clip.id)}" data-track-id="${escapeHtml(track.id)}" style="left:${clip.startTime * pps}px;width:${Math.max(18, clip.duration * pps)}px" title="${escapeHtml(title)} · ${durationLabel}" draggable="false">
        <span class="clip-handle clip-handle-left" data-trim="left" aria-label="Trim clip start"></span><div class="clip-face"><b>${escapeHtml(title)}</b><small>${durationLabel}</small></div><span class="clip-handle clip-handle-right" data-trim="right" aria-label="Trim clip end"></span>
      </div>`;
    }).join('')}
  </div>`).join('');
  return `<div class="timeline-content-inner" style="width:${width}px;min-width:${width}px"><div class="playhead-line"></div><div class="playhead-handle" title="Drag playhead"></div>${ruler}${lanes}</div>`;
}

function renderTimeline() {
  if (!state.store) return;
  const project = state.store.project;
  const tracks = project.tracks;
  const labels = renderTrackLabels(tracks);
  const content = renderTimelineContent();
  const leftColumn = $('#trackLabels');
  const mainLabels = $('#timelineLabelsDock');
  const mainContent = $('#timelineContentDock');
  if (leftColumn) leftColumn.innerHTML = labels;
  if (mainLabels) mainLabels.innerHTML = labels;
  if (mainContent) mainContent.innerHTML = content;
  $('#trackCount').textContent = `${tracks.length} TRACK${tracks.length === 1 ? '' : 'S'}`;
  const timeline = $('#timelineScrollDock');
  if (timeline) timeline.classList.toggle('empty-timeline', !getTimelineDuration(project));
  attachTimelineEvents();
  updatePlayheadPaint(state.playhead);
}

function renderStatus() {
  const model = state.models;
  const llmReady = Boolean(model?.llm?.installed && model?.llm?.runtimeAvailable);
  const whisperReady = Boolean(model?.whisper?.installed && model?.whisper?.runtimeAvailable);
  $('#assistantState').innerHTML = `<div class="model-state-row"><span class="model-led ${llmReady ? 'ready' : ''}"></span><div><b>Local LLM</b><small>${llmReady ? 'Installed · offline' : 'Local AI model required'}</small></div><button id="quickModelSetup" class="text-link">SET UP</button></div><div class="model-state-row"><span class="model-led ${whisperReady ? 'ready' : ''}"></span><div><b>Speech to text</b><small>${whisperReady ? 'Whisper ready · offline' : 'Whisper model required for captions'}</small></div></div>${!isDesktopApp() ? '<div class="browser-warning">Browser preview: local native AI, FFmpeg analysis and MP4 export are unavailable. Timeline edits still work in this preview.</div>' : ''}`;
  $('#quickModelSetup')?.addEventListener('click', openModelManager);
  $('#undoBtn').disabled = !state.store.canUndo();
  $('#redoBtn').disabled = !state.store.canRedo();
  $('#analysisButton').disabled = !state.backend.ffmpeg || !isDesktopApp() || !state.store.project.assets.some((asset) => asset.path);
  $('#analysisButton').title = $('#analysisButton').disabled ? 'FFmpeg analysis is available in the Windows desktop build when FFmpeg is installed.' : 'Run local FFmpeg scene and silence analysis';
  $('#exportBtn').title = !isDesktopApp() ? 'MP4 export is available in the Windows desktop build.' : !state.backend.ffmpeg ? 'FFmpeg was not found. Configure it in AI Model Manager.' : 'Export a real MP4 with local FFmpeg';
  $('#exportBtn').classList.toggle('export-unavailable', !isDesktopApp() || !state.backend.ffmpeg);
}

function renderMessages() {
  const conversation = $('#conversation');
  if (!conversation) return;
  if (!state.messages.length) {
    conversation.innerHTML = `<div class="welcome-message"><div class="welcome-badge">${icon('spark', 17)}</div><b>Talk to the editor.</b><p>Import a clip, then describe a specific edit. Simple timeline commands run locally. Speech, semantic and rendering features require their local tools to be installed.</p><div class="example-prompts"><button data-prompt="Remove the first 4 seconds">“Remove the first 4 seconds”</button><button data-prompt="Remove every silence longer than 1 second">“Remove silence over 1 second”</button><button data-prompt="Make this a 30 second vertical Short">“Make a 30 second Short”</button></div></div>`;
  } else {
    conversation.innerHTML = state.messages.map((message) => `<article class="chat-message ${message.role === 'user' ? 'user-message' : 'assistant-message'}"><div class="message-role">${message.role === 'user' ? 'YOU' : '<span class="mini-n">N</span> NEXUS LOCAL AGENT'}<span>${escapeHtml(message.time ?? '')}</span></div><div class="message-content">${escapeHtml(message.text).replace(/\n/g, '<br>')}</div>${message.detail ? `<small class="message-detail">${escapeHtml(message.detail)}</small>` : ''}</article>`).join('');
  }
  conversation.scrollTop = conversation.scrollHeight;
  $$('[data-prompt]', conversation).forEach((button) => button.addEventListener('click', () => {
    $('#commandInput').value = button.dataset.prompt;
    $('#commandInput').focus();
  }));
}

function addMessage(role, text, detail = '') {
  state.messages.push({ role, text: String(text), detail, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  state.messages = state.messages.slice(-80);
  if (state.store) {
    state.store.project.conversation = state.messages;
    scheduleAutosave();
  }
  renderMessages();
}

function renderPlan(plan) {
  state.pendingPlan = plan;
  const element = $('#pendingPlan');
  if (!plan) { element.hidden = true; element.innerHTML = ''; return; }
  element.hidden = false;
  const steps = plan.steps.map((step, index) => `<li><span class="plan-number">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(step)}</span><span class="plan-check">✓</span></li>`).join('');
  const warnings = plan.warnings.map((item) => `<div class="plan-warning"><b>NOTE</b> ${escapeHtml(item)}</div>`).join('');
  const unavailable = plan.unavailable.map((item) => `<div class="plan-unavailable"><b>UNAVAILABLE</b> ${escapeHtml(item)}</div>`).join('');
  element.innerHTML = `<div class="plan-card"><div class="plan-head"><div><span class="eyebrow">PREVIEW CHANGES</span><b>${escapeHtml(plan.summary)}</b></div><button id="cancelPlanButton" class="icon-button compact" title="Cancel plan">${icon('close', 14)}</button></div>${steps ? `<ol class="plan-steps">${steps}</ol>` : '<div class="plan-no-changes">No executable edits in this plan.</div>'}${warnings}${unavailable}<div class="plan-buttons"><button id="applyPlanButton" class="apply-plan-button" ${plan.actions.length ? '' : 'disabled'}>Apply ${plan.actions.length ? `· ${plan.actions.length}` : ''}</button><button id="modifyPlanButton" class="cancel-plan-button">Modify</button><button id="dismissPlanButton" class="cancel-plan-button">Cancel</button></div></div>`;
  $('#applyPlanButton')?.addEventListener('click', applyPendingPlan);
  $('#cancelPlanButton')?.addEventListener('click', () => renderPlan(null));
  $('#modifyPlanButton')?.addEventListener('click', () => { renderPlan(null); $('#commandInput').value = plan.command; $('#commandInput').focus(); });
  $('#dismissPlanButton')?.addEventListener('click', () => renderPlan(null));
}

function syncProjectName() {
  const input = $('#projectName');
  if (input && document.activeElement !== input) input.value = state.store.project.name;
}

function renderProject() {
  if (!state.store) return;
  syncProjectName();
  renderAssetList();
  renderTimeline();
  renderStatus();
  updatePreview(state.playhead);
}

function attachTimelineEvents() {
  const scroll = $('#timelineScrollDock');
  const content = $('#timelineContentDock');
  if (!scroll || !content) return;
  const pxs = state.pixelsPerSecond;
  const timeAtClientX = (clientX) => {
    const rect = content.getBoundingClientRect();
    return Math.max(0, Math.min(getTimelineDuration(state.store.project) + 12, (clientX - rect.left) / pxs));
  };
  $$('.ruler-tick', content).forEach((tick) => tick.addEventListener('click', (event) => setPlayhead(timeAtClientX(event.clientX))));
  const inner = $('.timeline-content-inner', content);
  inner?.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.playhead-handle');
    const line = event.target.closest('.playhead-line');
    if (!handle && !line) return;
    event.preventDefault();
    if (handle) handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => setPlayhead(timeAtClientX(moveEvent.clientX));
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  });
  inner?.addEventListener('click', (event) => {
    if (event.target.closest('.timeline-clip') || event.target.closest('.playhead-handle')) return;
    setPlayhead(timeAtClientX(event.clientX));
  });
  inner?.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('application/x-nexus-asset')) event.preventDefault(); });
  inner?.addEventListener('drop', (event) => {
    const assetId = event.dataTransfer?.getData('application/x-nexus-asset');
    if (!assetId) return;
    event.preventDefault();
    const target = event.target.closest('.track-lane');
    const trackId = target?.dataset.trackId;
    const start = timeAtClientX(event.clientX);
    state.store.commit('Add media to timeline', (project) => {
      const clip = addAssetToTimeline(project, assetId, start, trackId || null);
      if (!clip) throw new Error('That media type cannot be dropped onto this track.');
      state.selectedClipId = clip.id;
    });
  });

  $$('.timeline-clip', inner).forEach((element) => {
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const id = element.dataset.clipId;
      const found = state.store.project.tracks.map((track) => ({ track, clip: track.clips.find((clip) => clip.id === id) })).find((item) => item.clip);
      if (!found) return;
      state.selectedClipId = id;
      renderTimeline();
      const refreshed = $(`.timeline-clip[data-clip-id="${CSS.escape(id)}"]`, $('#timelineContentDock'));
      if (!refreshed) return;
      const target = event.target.closest('[data-trim]');
      const mode = target?.dataset.trim ?? 'move';
      const startX = event.clientX;
      const original = { startTime: found.clip.startTime, duration: found.clip.duration, sourceIn: found.clip.sourceIn, sourceOut: found.clip.sourceOut };
      let moved = false;
      const move = (moveEvent) => {
        const delta = (moveEvent.clientX - startX) / state.pixelsPerSecond;
        if (Math.abs(delta) < 0.03) return;
        moved = true;
        if (mode === 'left') {
          const trim = Math.max(-original.startTime, Math.min(original.duration - 0.08, delta));
          refreshed.style.left = `${(original.startTime + trim) * state.pixelsPerSecond}px`;
          refreshed.style.width = `${Math.max(18, (original.duration - trim) * state.pixelsPerSecond)}px`;
        } else if (mode === 'right') {
          const duration = Math.max(0.08, original.duration + delta);
          refreshed.style.width = `${Math.max(18, duration * state.pixelsPerSecond)}px`;
        } else {
          refreshed.style.left = `${Math.max(0, original.startTime + delta) * state.pixelsPerSecond}px`;
        }
      };
      const end = (endEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        if (!moved) { renderTimeline(); return; }
        const delta = (endEvent.clientX - startX) / state.pixelsPerSecond;
        state.store.commit(mode === 'move' ? 'Move clip' : 'Trim clip', (project) => {
          const item = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);
          const track = project.tracks.find((candidate) => candidate.clips.includes(item));
          if (!item || track?.locked) throw new Error('This track is locked.');
          if (mode === 'left') {
            const trim = Math.max(-original.startTime, Math.min(original.duration - 0.08, delta));
            item.startTime = Math.max(0, original.startTime + trim);
            item.duration = original.duration - trim;
            if (Number.isFinite(original.sourceIn)) item.sourceIn = original.sourceIn + trim;
            if (Number.isFinite(item.sourceIn)) item.sourceOut = item.sourceIn + item.duration;
          } else if (mode === 'right') {
            item.duration = Math.max(0.08, original.duration + delta);
            if (Number.isFinite(item.sourceIn)) item.sourceOut = item.sourceIn + item.duration;
          } else item.startTime = Math.max(0, original.startTime + delta);
          track?.clips.sort((a, b) => a.startTime - b.startTime);
        });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
    });
  });

  $$('[data-track-mute]', document).forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.trackMute;
    state.store.commit('Toggle track mute', (project) => {
      const track = project.tracks.find((item) => item.id === id);
      if (track) track.muted = !track.muted;
    });
  }));
  $$('[data-track-visible]', document).forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.trackVisible;
    state.store.commit('Toggle track visibility', (project) => {
      const track = project.tracks.find((item) => item.id === id);
      if (track) track.visible = track.visible === false;
    });
  }));
  $$('[data-track-lock]', document).forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.trackLock;
    state.store.commit('Toggle track lock', (project) => {
      const track = project.tracks.find((item) => item.id === id);
      if (track) track.locked = !track.locked;
    });
  }));
}

function setPlayhead(time) {
  const duration = getTimelineDuration(state.store.project);
  state.playhead = Math.max(0, Math.min(Math.max(duration, 0), Number(time) || 0));
  updatePreview(state.playhead);
}

async function startPlayback() {
  if (state.playing) return stopPlayback();
  if (state.playhead >= getTimelineDuration(state.store.project)) setPlayhead(0);
  state.playing = true;
  state.playClock = performance.now() - state.playhead * 1000;
  $('#playButton').innerHTML = icon('pause', 17);
  const video = $('#previewVideo');
  updatePreview(state.playhead);
  if (!video.hidden && video.readyState >= 2) video.play().catch((error) => addLog('warning', 'Preview playback did not start.', error.message));
  const tick = (now) => {
    if (!state.playing) return;
    const duration = getTimelineDuration(state.store.project);
    const current = Math.max(0, (now - state.playClock) / 1000);
    if (current >= duration) { setPlayhead(duration); stopPlayback(); return; }
    state.playhead = current;
    if (now - state.lastPreviewPaint > 90) {
      state.lastPreviewPaint = now;
      updatePreview(current);
    }
    state.animationFrame = requestAnimationFrame(tick);
  };
  state.animationFrame = requestAnimationFrame(tick);
}

function stopPlayback() {
  state.playing = false;
  cancelAnimationFrame(state.animationFrame);
  const video = $('#previewVideo');
  video.pause();
  for (const player of state.previewAudioPlayers.values()) player.element.pause();
  $('#playButton').innerHTML = icon('play', 18);
  updatePreview(state.playhead);
}

function addAssetFromBin(assetId, startTime = null, targetTrackId = null) {
  let created = null;
  state.store.commit('Add clip to timeline', (project) => {
    created = addAssetToTimeline(project, assetId, startTime, targetTrackId);
    if (!created) throw new Error('This image or media file cannot be placed on that track.');
    state.selectedClipId = created.id;
  });
  if (created) { toast('Added to timeline', 'success', getAssetById(state.store.project, assetId)?.name); setPlayhead(created.startTime); }
}

async function relinkMedia(assetId) {
  const original = getAssetById(state.store.project, assetId);
  if (!original) return;
  try {
    const picked = await pickMediaFiles();
    if (!picked || (Array.isArray(picked) && !picked.length)) return;
    const candidates = await importPickedMedia(typeof picked === 'string' ? [picked] : Array.isArray(picked) ? [picked[0]] : [picked]);
    const replacement = candidates[0];
    if (!replacement) throw new Error('No replacement media could be read.');
    if (replacement.mediaType !== original.mediaType) {
      if (replacement.browserUrl) URL.revokeObjectURL(replacement.browserUrl);
      if (replacement.storageKey) await removeCachedMediaBlob(replacement.storageKey);
      throw new Error(`Choose a ${original.mediaType} file to relink “${original.name}”.`);
    }
    const oldName = original.name;
    const oldStorageKey = original.storageKey;
    const oldObjectUrl = state.objectUrls.get(assetId);
    state.store.commit('Relink source media', (project) => {
      const asset = getAssetById(project, assetId);
      Object.assign(asset, {
        name: replacement.name, path: replacement.path, storageKey: replacement.storageKey,
        duration: replacement.duration, width: replacement.width, height: replacement.height,
        fps: replacement.fps, hasAudio: replacement.hasAudio, size: replacement.size, missing: false,
      });
    });
    if (replacement.browserUrl) state.objectUrls.set(assetId, replacement.browserUrl);
    else state.objectUrls.delete(assetId);
    if (oldObjectUrl && oldObjectUrl !== replacement.browserUrl) URL.revokeObjectURL(oldObjectUrl);
    if (oldStorageKey && oldStorageKey !== replacement.storageKey) await removeCachedMediaBlob(oldStorageKey);
    renderProject();
    toast('Media relinked', 'success', `${oldName} → ${replacement.name}`);
  } catch (error) {
    addLog('error', 'Media relink failed.', error.message);
    toast('Relink failed', 'error', error.message);
  }
}

async function importMedia() {
  const picked = await pickMediaFiles();
  if (!picked || (Array.isArray(picked) && !picked.length)) return;
  toast('Importing media…', 'info', 'Reading file metadata locally.');
  const assets = await importPickedMedia(picked, (progress) => {
    if (progress.error) { addLog('error', 'Media import failed.', progress.error); toast('Import failed', 'error', progress.error); }
  });
  if (!assets.length) return;
  const toAdd = [];
  state.store.commit('Import media', (project) => {
    for (const data of assets) {
      const firstOfType = !getAllClips(project).some((clip) => clip.trackType === (data.mediaType === 'audio' ? 'audio' : 'video'));
      const asset = addMediaAsset(project, data, false);
      if (!asset) continue;
      if (data.browserUrl) state.objectUrls.set(asset.id, data.browserUrl);
      toAdd.push({ asset, autoAdd: firstOfType && data.mediaType !== 'image' });
    }
    for (const item of toAdd) if (item.autoAdd) {
      const clip = addAssetToTimeline(project, item.asset.id);
      if (clip) state.selectedClipId = clip.id;
    }
  });
  renderProject();
  const autoAdded = toAdd.filter((item) => item.autoAdd).length;
  toast(`Imported ${assets.length} file${assets.length === 1 ? '' : 's'}`, 'success', autoAdded ? `${autoAdded} first clip(s) added to the timeline.` : 'Choose + on a media card to add it to the timeline.');
}

function selectedClip() {
  if (!state.selectedClipId) return null;
  return getAllClips(state.store.project).find((clip) => clip.id === state.selectedClipId) ?? null;
}

function doSplit() {
  const clip = selectedClip();
  if (!clip) { toast('Select a clip first', 'warning'); return; }
  try {
    state.store.commit('Split clip at playhead', (project) => {
      const result = splitClip(project, clip.id, state.playhead);
      if (!result) throw new Error('Place the playhead inside the selected clip to split it.');
      state.selectedClipId = result.right.id;
    });
    toast('Clip split', 'success', `At ${formatTime(state.playhead, state.store.project.settings.fps, true)}`);
  } catch (error) { toast('Split not applied', 'error', error.message); }
}

function deleteSelectedClip() {
  const id = state.selectedClipId;
  if (!id) { toast('Select a timeline clip first', 'warning'); return; }
  state.store.commit('Delete clip from timeline', (project) => {
    const track = project.tracks.find((item) => item.clips.some((clip) => clip.id === id));
    if (!track || track.locked) throw new Error('This clip is on a locked track.');
    track.clips = track.clips.filter((clip) => clip.id !== id);
    state.selectedClipId = null;
  });
  toast('Clip removed from timeline', 'success', 'The original source file was not changed.');
}

function runUndo() {
  const label = state.store.undo();
  if (!label) { toast('Nothing to undo', 'warning'); return; }
  state.selectedClipId = null;
  toast('Undo complete', 'success', label);
}
function runRedo() {
  const label = state.store.redo();
  if (!label) { toast('Nothing to redo', 'warning'); return; }
  state.selectedClipId = null;
  toast('Redo complete', 'success', label);
}

async function submitCommand(event) {
  event.preventDefault();
  const input = $('#commandInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMessage('user', text);
  renderPlan(null);
  const lower = text.toLowerCase();
  if (/^\s*(undo|undo the last (?:change|edit|action))\s*[.!]?$/i.test(lower)) { runUndo(); addMessage('assistant', 'Undid the last timeline change.'); return; }
  if (/^\s*(redo|redo the last (?:change|edit|action))\s*[.!]?$/i.test(lower)) { runRedo(); addMessage('assistant', 'Redid the last timeline change.'); return; }
  const send = $('.send-command'); send.disabled = true; send.classList.add('busy');
  try {
    const projectBefore = cloneProject(state.store.project);
    const plan = await prepareCommand(text, state.store.project, state.selectedClipId, { playhead: state.playhead, modelStatus: state.models });
    if (plan.control === 'undo') { runUndo(); addMessage('assistant', 'Undid the last timeline change.'); return; }
    if (plan.control === 'redo') { runRedo(); addMessage('assistant', 'Redid the last timeline change.'); return; }
    if (plan.requiresReview) {
      plan.beforeProject = projectBefore;
      renderPlan(plan);
      addMessage('assistant', plan.summary, plan.actions.length ? 'Review the concrete changes below before they are applied.' : 'No edit has been applied.');
      return;
    }
    if (plan.actions.length) {
      applyPlan(state.store, plan);
      const response = directCommandResult(plan, projectBefore, state.store.project);
      addMessage('assistant', response);
      toast('Timeline updated', 'success', response);
    } else {
      for (const item of plan.cache ?? []) cacheAnalysis(item);
      addMessage('assistant', plan.summary, plan.warnings.join(' '));
    }
  } catch (error) {
    addLog('error', 'Natural-language operation failed.', error.message);
    const localRequired = /local ai model required/i.test(error.message);
    addMessage('assistant', localRequired ? 'Local AI model required.' : 'AI ACTION FAILED', error.message);
    toast(localRequired ? 'Local AI model required' : 'Action failed', 'error', error.message);
  } finally {
    send.disabled = false; send.classList.remove('busy');
  }
}

function cacheAnalysis(item) {
  if (!state.store.project.analysis) state.store.project.analysis = { byAsset: {} };
  if (!state.store.project.analysis.byAsset) state.store.project.analysis.byAsset = {};
  if (item.kind === 'silence') for (const entry of item.assets) {
    state.store.project.analysis.byAsset[entry.assetId] = { ...(state.store.project.analysis.byAsset[entry.assetId] ?? {}), silence: entry.result, silenceAnalyzedAt: new Date().toISOString() };
  }
  scheduleAutosave();
}

function applyPendingPlan() {
  const plan = state.pendingPlan;
  if (!plan?.actions.length) return;
  try {
    applyPlan(state.store, plan);
    const response = directCommandResult(plan, plan.beforeProject, state.store.project);
    renderPlan(null);
    addMessage('assistant', response, plan.unavailable.length ? `Unavailable: ${plan.unavailable.join(' ')}` : plan.warnings.join(' '));
    toast('Plan applied', 'success', `${plan.actions.length} reversible operation(s).`);
  } catch (error) {
    addLog('error', 'Could not apply the AI plan.', error.message);
    addMessage('assistant', 'AI ACTION FAILED', error.message);
    toast('Plan was not applied', 'error', error.message);
  }
}

function setModal(content, className = '') {
  state.modal = className;
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><section class="modal-card ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
  $('#modalBackdrop').addEventListener('click', (event) => { if (event.target.id === 'modalBackdrop') closeModal(); });
  $('#modalRoot').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); }, { once: true });
  $('#modalRoot').focus?.();
}
function closeModal() { state.modal = null; $('#modalRoot').innerHTML = ''; }

function openModelManager() {
  const model = state.models;
  const desktopMessage = isDesktopApp() ? '' : '<div class="modal-callout"><b>Desktop setup needed</b><span>Model paths and offline runtimes are connected by the Windows desktop build. Browser preview cannot access local executables.</span></div>';
  setModal(`<div class="modal-header"><div><span class="eyebrow">OFFLINE-FIRST</span><h2>AI Model Manager</h2><p>Models and inference stay on this computer. No cloud API is used.</p></div><button class="icon-button" id="closeModal">${icon('close')}</button></div>
    ${desktopMessage}
    <div class="model-manager-grid">
      <article class="managed-model"><div class="model-card-top"><span class="model-category-icon">LLM</span><span class="model-status-pill ${model.llm?.installed && model.llm?.runtimeAvailable ? 'installed' : ''}">${model.llm?.installed ? (model.llm?.runtimeAvailable ? 'READY' : 'MODEL FOUND') : 'NOT INSTALLED'}</span></div><h3>Local language model</h3><p>GGUF model + llama.cpp CLI. Required for open-ended requests such as “remove the boring parts.”</p><div class="model-path">${escapeHtml(model.llm?.modelPath || 'Local AI model required')}</div><div class="model-card-actions"><button data-set-model="llm_model" ${!isDesktopApp() ? 'disabled' : ''}>Choose GGUF</button><button data-download-model="qwen-small" ${!isDesktopApp() ? 'disabled' : ''}>Download starter model</button></div><div class="runtime-row"><span>llama.cpp runtime</span><b>${model.llm?.runtimeAvailable ? 'Ready' : 'Not installed'}</b><button data-set-model="llm_runtime" ${!isDesktopApp() ? 'disabled' : ''}>Locate</button></div></article>
      <article class="managed-model"><div class="model-card-top"><span class="model-category-icon whisper">STT</span><span class="model-status-pill ${model.whisper?.installed && model.whisper?.runtimeAvailable ? 'installed' : ''}">${model.whisper?.installed ? (model.whisper?.runtimeAvailable ? 'READY' : 'MODEL FOUND') : 'NOT INSTALLED'}</span></div><h3>Whisper speech model</h3><p>Local timestamped speech recognition for captions, silence-aware edits and speech-linked zooms.</p><div class="model-path">${escapeHtml(model.whisper?.modelPath || 'Local AI model required')}</div><div class="model-card-actions"><button data-set-model="whisper_model" ${!isDesktopApp() ? 'disabled' : ''}>Choose model</button><button data-download-model="whisper-tiny" ${!isDesktopApp() ? 'disabled' : ''}>Download tiny model</button></div><div class="runtime-row"><span>whisper.cpp runtime</span><b>${model.whisper?.runtimeAvailable ? 'Ready' : 'Not installed'}</b><button data-set-model="whisper_runtime" ${!isDesktopApp() ? 'disabled' : ''}>Locate</button></div></article>
      <article class="managed-model compact-model"><div class="model-card-top"><span class="model-category-icon vision">CV</span><span class="model-status-pill">${model.vision?.installed ? 'INSTALLED' : 'NOT INSTALLED'}</span></div><h3>Vision model</h3><p>Subject/face tracking is unavailable until a compatible local vision runtime is configured. Center-crop reframing remains available.</p><div class="model-path">${escapeHtml(model.vision?.modelPath || 'Not installed')}</div><div class="model-card-actions"><button disabled title="Vision runtime adapter is not configured in this build">Unavailable</button></div></article>
      <article class="managed-model compact-model"><div class="model-card-top"><span class="model-category-icon ffmpeg">FF</span><span class="model-status-pill ${state.backend.ffmpeg ? 'installed' : ''}">${state.backend.ffmpeg ? 'READY' : 'NOT FOUND'}</span></div><h3>FFmpeg media engine</h3><p>Required for native MP4 rendering, scene/silence analysis, rescaling, audio filters and export progress.</p><div class="model-path">${escapeHtml(state.backend.ffmpegPath || 'Add ffmpeg.exe to PATH or locate it')}</div><div class="model-card-actions"><button data-set-model="ffmpeg" ${!isDesktopApp() ? 'disabled' : ''}>Locate FFmpeg</button><button id="refreshBackendButton" ${!isDesktopApp() ? 'disabled' : ''}>Check again</button></div></article>
    </div>
    <div class="model-manager-foot"><span>Models may be large. Downloads are optional; editing and project files work offline.</span><button class="secondary-button" id="modelDone">Done</button></div>`);
  $('#closeModal').addEventListener('click', closeModal);
  $('#modelDone').addEventListener('click', closeModal);
  $('#refreshBackendButton')?.addEventListener('click', async () => { await refreshStatuses(); openModelManager(); });
  $$('[data-set-model]').forEach((button) => button.addEventListener('click', async () => {
    const kind = button.dataset.setModel;
    try {
      const selected = await pickModelOrRuntimeFile(kind);
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : selected.name;
      if (typeof selected !== 'string') throw new Error('A desktop file path is required for local models.');
      await setModelFile(kind, path);
      await refreshStatuses(); openModelManager();
      toast('Local file configured', 'success', kind.replace('_', ' '));
    } catch (error) { toast('Could not configure file', 'error', error.message); }
  }));
  $$('[data-download-model]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const id = button.dataset.downloadModel;
      closeModal();
      const result = await invokeNative('download_model', { modelId: id });
      await refreshStatuses();
      toast('Model downloaded', 'success', result.path);
      openModelManager();
    } catch (error) { addLog('error', 'Local model download failed.', error.message); toast('Download failed', 'error', error.message); openModelManager(); }
  }));
}

function openLogs() {
  const rows = state.logs.map((entry) => `<div class="log-entry log-${entry.level}"><time>${escapeHtml(new Date(entry.time).toLocaleTimeString())}</time><b>${escapeHtml(entry.level.toUpperCase())}</b><span>${escapeHtml(entry.message)}</span>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}</div>`).join('');
  setModal(`<div class="modal-header"><div><span class="eyebrow">DIAGNOSTICS</span><h2>Application logs</h2><p>Local error details and processing diagnostics.</p></div><button class="icon-button" id="closeModal">${icon('close')}</button></div><div class="log-list">${rows || '<div class="empty-state">No application errors have been logged.</div>'}</div><div class="modal-actions"><button class="secondary-button" id="clearLogs">Clear logs</button><button class="secondary-button" id="closeLogs">Close</button></div>`);
  $('#closeModal').addEventListener('click', closeModal); $('#closeLogs').addEventListener('click', closeModal);
  $('#clearLogs').addEventListener('click', () => { state.logs = []; openLogs(); });
}

async function verifyProjectSources(project) {
  await Promise.all(project.assets.map(async (asset) => {
    if (isDesktopApp() && asset.path) {
      try { await invokeNative('probe_media', { path: asset.path }); asset.missing = false; }
      catch { asset.missing = true; }
    } else if (asset.storageKey && !state.objectUrls.has(asset.id)) asset.missing = true;
  }));
}

async function openProject() {
  try {
    const selection = await readProjectSelection();
    if (!selection) return;
    const project = validateProject(selection.project);
    stopPlayback();
    state.store.replace(project, 'Open project');
    state.messages = Array.isArray(project.conversation) ? project.conversation.slice(-80) : [];
    state.projectPath = selection.path;
    state.selectedClipId = null;
    state.playhead = 0;
    state.objectUrls.forEach((url) => URL.revokeObjectURL(url)); state.objectUrls.clear();
    const restored = await restoreCachedAssetUrls(state.store.project);
    for (const [id, url] of restored) state.objectUrls.set(id, url);
    await verifyProjectSources(state.store.project);
    renderMessages(); renderProject();
    const missing = project.assets.filter((asset) => asset.missing || (!asset.path && !state.objectUrls.has(asset.id))).length;
    toast('Project opened', 'success', missing ? `${missing} source file(s) need to be relinked.` : project.name);
  } catch (error) { addLog('error', 'Project could not be opened.', error.message); toast('Open failed', 'error', error.message); }
}

async function saveProject() {
  try {
    const path = await persistProject(state.store.project, state.projectPath);
    if (!path) return;
    if (path !== 'downloaded') state.projectPath = path;
    setSaveStatus('SAVED');
    toast('Project saved', 'success', path === 'downloaded' ? 'Downloaded .nexusvideo project file.' : path);
  } catch (error) { addLog('error', 'Project save failed.', error.message); toast('Save failed', 'error', error.message); }
}

function newProject() {
  if (state.store.project.assets.length && !confirm('Create a new project? Make sure your current project is saved.')) return;
  stopPlayback();
  const project = createProject('Untitled Project');
  state.store.replace(project, 'New project');
  state.projectPath = null; state.selectedClipId = null; state.playhead = 0; state.messages = []; renderPlan(null); renderMessages();
  toast('New project created', 'success');
}

async function analyzeProject() {
  const project = state.store.project;
  const items = project.assets.filter((asset) => asset.path && asset.mediaType !== 'image');
  if (!items.length) { toast('No local media to analyze', 'warning'); return; }
  const button = $('#analysisButton'); button.disabled = true; button.classList.add('busy');
  addMessage('assistant', `Analyzing ${items.length} local media file${items.length === 1 ? '' : 's'} with FFmpeg…`, 'Scene change and silence detection only. Face/person detection requires an installed vision runtime.');
  try {
    const results = [];
    for (const asset of items) {
      const [scenes, silence] = await Promise.all([
        invokeNative('detect_scenes', { path: asset.path, threshold: 0.32 }),
        invokeNative('analyze_silence', { path: asset.path, noiseDb: -35, minDuration: 0.5 }),
      ]);
      results.push({ assetId: asset.id, scenes, silence });
    }
    for (const result of results) project.analysis.byAsset[result.assetId] = { scenes: result.scenes, silence: result.silence, analyzedAt: new Date().toISOString() };
    scheduleAutosave(); renderAssetList();
    const sceneCount = results.reduce((sum, item) => sum + (item.scenes?.times?.length ?? 0), 0);
    const silenceCount = results.reduce((sum, item) => sum + (item.silence?.intervals?.length ?? 0), 0);
    const report = `Analysis complete. ${sceneCount} scene changes and ${silenceCount} silence section(s) detected across ${items.length} asset(s).`;
    addMessage('assistant', report, 'Stored locally in project analysis cache. No faces or semantic highlights were inferred.');
    toast('Local analysis complete', 'success', `${sceneCount} scene changes · ${silenceCount} silence sections`);
  } catch (error) {
    addLog('error', 'Media analysis failed.', error.message);
    addMessage('assistant', 'MEDIA ANALYSIS FAILED', error.message);
    toast('Analysis failed', 'error', error.message);
  } finally { button.classList.remove('busy'); button.disabled = !state.backend.ffmpeg; }
}

function exportFormTemplate() {
  const project = state.store.project;
  const size = `${project.settings.width}x${project.settings.height}`;
  const desktop = isDesktopApp();
  const ffmpegReady = Boolean(state.backend.ffmpeg);
  return `<div class="modal-header"><div><span class="eyebrow">LOCAL RENDER</span><h2>Export video</h2><p>FFmpeg renders the current non-destructive timeline into a new file.</p></div><button class="icon-button" id="closeModal">${icon('close')}</button></div>
    ${!desktop ? '<div class="modal-callout unavailable-callout"><b>Desktop render engine required</b><span>MP4 export is unavailable in this browser preview. Open the Windows desktop app with FFmpeg configured; this button will not generate a fake file.</span></div>' : !ffmpegReady ? '<div class="modal-callout unavailable-callout"><b>FFmpeg was not found</b><span>Locate a local ffmpeg.exe in AI Model Manager. No export will begin until the real encoder is available.</span></div>' : ''}
    <div class="export-fields"><label>Preset<select id="exportPreset"><option value="custom">Current sequence · ${escapeHtml(size)}</option><option value="youtube">YouTube · 1920 × 1080</option><option value="short">Shorts / Reels / TikTok · 1080 × 1920</option><option value="square">Square · 1080 × 1080</option></select></label><div class="field-row"><label>Width<input id="exportWidth" type="number" min="144" max="7680" value="${project.settings.width}"></label><label>Height<input id="exportHeight" type="number" min="144" max="7680" value="${project.settings.height}"></label><label>FPS<select id="exportFps"><option ${project.settings.fps === 24 ? 'selected' : ''}>24</option><option ${project.settings.fps === 25 ? 'selected' : ''}>25</option><option ${project.settings.fps === 30 ? 'selected' : ''}>30</option><option ${project.settings.fps === 50 ? 'selected' : ''}>50</option><option ${project.settings.fps === 60 ? 'selected' : ''}>60</option></select></label></div><div class="field-row"><label>Video codec<select id="exportCodec"><option value="h264">H.264 · MP4</option><option value="h265">H.265 · MP4</option></select></label><label>Video bitrate<select id="exportBitrate"><option value="6000k">6 Mbps</option><option value="10000k">10 Mbps</option><option value="16000k">16 Mbps</option><option value="25000k">25 Mbps</option></select></label></div><label>Output file<div class="path-picker"><input id="exportPath" readonly placeholder="Choose an output .mp4 file"><button id="chooseExportPathButton" type="button">Browse</button></div></label></div>
    <div id="renderProgressBox" class="render-progress-box" ${state.renderProgress ? '' : 'hidden'}><div class="progress-meta"><b id="renderStatusText">${escapeHtml(state.renderProgress?.status ?? 'Rendering…')}</b><span id="renderPercent">${state.renderProgress?.percent ?? 0}%</span></div><div class="progress-track"><i id="renderProgressBar" style="width:${state.renderProgress?.percent ?? 0}%"></i></div><small id="renderProgressDetail">${escapeHtml(state.renderProgress?.detail ?? 'Local FFmpeg render')}</small></div>
    <div class="modal-actions"><button class="secondary-button" id="cancelExportButton">Close</button><button class="primary-button" id="startExportButton" ${!desktop || !ffmpegReady || !getTimelineDuration(project) ? 'disabled' : ''}>${icon('export', 15)} Export MP4</button></div>`;
}

async function openExportModal() {
  state.renderProgress = null;
  setModal(exportFormTemplate(), 'export-modal');
  $('#closeModal').addEventListener('click', closeModal); $('#cancelExportButton').addEventListener('click', closeModal);
  $('#exportPreset').addEventListener('change', (event) => {
    const value = event.target.value;
    const size = value === 'short' ? [1080, 1920] : value === 'youtube' ? [1920, 1080] : value === 'square' ? [1080, 1080] : [state.store.project.settings.width, state.store.project.settings.height];
    $('#exportWidth').value = size[0]; $('#exportHeight').value = size[1];
  });
  $('#chooseExportPathButton').addEventListener('click', async () => {
    try { const path = await chooseExportPath(`${safeName(state.store.project.name)}.mp4`); if (path) $('#exportPath').value = path; }
    catch (error) { toast('Could not choose output path', 'error', error.message); }
  });
  $('#startExportButton').addEventListener('click', startExport);
  if (state.renderUnlisten) state.renderUnlisten();
  state.renderUnlisten = await listenNative('export-progress', (payload) => {
    state.renderProgress = { status: payload.status ?? 'Rendering…', percent: Math.max(0, Math.min(100, Math.round(payload.percent ?? 0))), detail: payload.outTime ?? 'Local FFmpeg render' };
    updateRenderProgress();
  });
}

function updateRenderProgress() {
  if (!$('#renderProgressBox')) return;
  const progress = state.renderProgress ?? { percent: 0, status: 'Rendering…', detail: '' };
  $('#renderProgressBox').hidden = false;
  $('#renderStatusText').textContent = progress.status;
  $('#renderPercent').textContent = `${progress.percent}%`;
  $('#renderProgressBar').style.width = `${progress.percent}%`;
  $('#renderProgressDetail').textContent = progress.detail;
}

async function startExport() {
  const button = $('#startExportButton');
  const project = state.store.project;
  let path = $('#exportPath').value;
  if (!path) {
    path = await chooseExportPath(`${safeName(project.name)}.mp4`);
    if (!path) { toast('Choose an output file first', 'warning'); return; }
    $('#exportPath').value = path;
  }
  const options = {
    width: Number($('#exportWidth').value), height: Number($('#exportHeight').value), fps: Number($('#exportFps').value),
    codec: $('#exportCodec').value, videoBitrate: $('#exportBitrate').value,
  };
  button.disabled = true; button.innerHTML = 'Rendering…';
  $('#renderProgressBox').hidden = false;
  $('#renderStatusText').textContent = 'Preparing FFmpeg graph…';
  try {
    state.renderProgress = { status: 'Preparing render', percent: 0, detail: 'Validating project paths and local codecs.' };
    updateRenderProgress();
    const result = await invokeNative('export_timeline', { projectJson: JSON.stringify(project), outputPath: path, options });
    state.renderProgress = { status: 'Export complete', percent: 100, detail: result.path };
    updateRenderProgress();
    toast('Video exported', 'success', result.path);
    addLog('info', 'MP4 export completed.', result.path);
    addMessage('assistant', 'Export complete. FFmpeg wrote a real MP4 file.', result.path);
    setTimeout(closeModal, 900);
  } catch (error) {
    state.renderProgress = { status: 'Export failed', percent: 0, detail: error.message };
    updateRenderProgress();
    addLog('error', 'FFmpeg export failed.', error.message);
    toast('Export failed', 'error', error.message);
  } finally {
    if ($('#startExportButton')) { $('#startExportButton').disabled = false; $('#startExportButton').innerHTML = `${icon('export', 15)} Export MP4`; }
  }
}

async function refreshStatuses() {
  try { state.backend = await getBackendStatus(); }
  catch (error) { addLog('warning', 'Could not check local media engine.', error.message); }
  try { state.models = await refreshAIModels(); }
  catch (error) { addLog('warning', 'Could not check local model status.', error.message); }
  renderStatus();
}

function addTrack() {
  const choices = ['video', 'audio', 'caption'];
  const type = prompt('Add track: enter video, audio, or captions', 'video')?.trim().toLowerCase();
  if (!type || !choices.includes(type)) { if (type) toast('Track type not recognized', 'warning'); return; }
  state.store.commit('Add track', (project) => {
    const index = project.tracks.filter((track) => track.type === type).length + 1;
    project.tracks.push({ id: makeId(`track-${type}`), name: `${type === 'caption' ? 'Captions' : type[0].toUpperCase() + type.slice(1)} ${index}`, type, clips: [], muted: false, locked: false, visible: true });
  });
}

function setupEvents() {
  $('#importButton').addEventListener('click', importMedia);
  $('#importDrop').addEventListener('click', importMedia);
  $('#emptyImportButton').addEventListener('click', importMedia);
  $('#importDrop').addEventListener('dragover', (event) => { event.preventDefault(); $('#importDrop').classList.add('drag-over'); });
  $('#importDrop').addEventListener('dragleave', () => $('#importDrop').classList.remove('drag-over'));
  $('#importDrop').addEventListener('drop', async (event) => {
    event.preventDefault(); $('#importDrop').classList.remove('drag-over');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) await importMediaFromFiles(files);
  });
  document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', async (event) => {
    if (!event.dataTransfer?.files?.length || event.target.closest('#importDrop')) return;
    event.preventDefault(); await importMediaFromFiles(Array.from(event.dataTransfer.files));
  });
  $('#analysisButton').addEventListener('click', analyzeProject);
  $('#commandForm').addEventListener('submit', submitCommand);
  $('#saveProjectBtn').addEventListener('click', saveProject);
  $('#openProjectBtn').addEventListener('click', openProject);
  $('#newProjectBtn').addEventListener('click', newProject);
  $('#undoBtn').addEventListener('click', runUndo); $('#redoBtn').addEventListener('click', runRedo);
  $('#playButton').addEventListener('click', startPlayback);
  $('#stepBackButton').addEventListener('click', () => setPlayhead(state.playhead - 1 / state.store.project.settings.fps));
  $('#stepForwardButton').addEventListener('click', () => setPlayhead(state.playhead + 1 / state.store.project.settings.fps));
  $('#splitButton').addEventListener('click', doSplit); $('#deleteClipButton').addEventListener('click', deleteSelectedClip);
  $('#zoomInButton').addEventListener('click', () => { state.pixelsPerSecond = Math.min(140, state.pixelsPerSecond + 8); $('#timelineZoom').value = state.pixelsPerSecond; renderTimeline(); });
  $('#zoomOutButton').addEventListener('click', () => { state.pixelsPerSecond = Math.max(20, state.pixelsPerSecond - 8); $('#timelineZoom').value = state.pixelsPerSecond; renderTimeline(); });
  $('#timelineZoom').addEventListener('input', (event) => { state.pixelsPerSecond = Number(event.target.value); renderTimeline(); });
  $('#addTrackButton').addEventListener('click', addTrack);
  $('#modelManagerBtn').addEventListener('click', openModelManager); $('#assistantModelsShortcut').addEventListener('click', openModelManager);
  $('#logsBtn').addEventListener('click', openLogs); $('#exportBtn').addEventListener('click', openExportModal);
  $('#projectName').addEventListener('change', (event) => {
    const name = event.target.value.trim() || 'Untitled Project';
    state.store.commit('Rename project', (project) => { project.name = name; });
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); event.shiftKey ? runRedo() : runUndo(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !typing) { event.preventDefault(); runRedo(); }
    else if (event.code === 'Space' && !typing) { event.preventDefault(); startPlayback(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && !typing) { event.preventDefault(); deleteSelectedClip(); }
  });
}

async function importMediaFromFiles(files) {
  const assets = await importPickedMedia(files, (progress) => { if (progress.error) toast('Import failed', 'error', progress.error); });
  if (!assets.length) return;
  const newlyAdded = [];
  state.store.commit('Import media', (project) => {
    for (const data of assets) {
      const type = data.mediaType === 'audio' ? 'audio' : 'video';
      const shouldPlace = data.mediaType !== 'image' && !getAllClips(project).some((clip) => clip.trackType === type);
      const asset = addMediaAsset(project, data, false);
      if (!asset) continue;
      if (data.browserUrl) state.objectUrls.set(asset.id, data.browserUrl);
      newlyAdded.push({ asset, shouldPlace });
    }
    for (const item of newlyAdded) if (item.shouldPlace) {
      const clip = addAssetToTimeline(project, item.asset.id);
      if (clip) state.selectedClipId = clip.id;
    }
  });
  renderProject(); toast(`Imported ${assets.length} file${assets.length === 1 ? '' : 's'}`, 'success', 'Media is stored locally; original files remain unchanged.');
}

function storeChanged(project, event = {}) {
  if (event.type === 'commit' || event.type === 'replace' || event.type === 'undo' || event.type === 'redo') {
    scheduleAutosave(); renderProject();
  }
}

async function boot() {
  renderShell();
  const project = loadLastProject() ?? createProject();
  const urls = await restoreCachedAssetUrls(project);
  state.objectUrls = urls;
  await verifyProjectSources(project);
  state.store = new ProjectStore(project, storeChanged);
  state.messages = Array.isArray(project.conversation) ? project.conversation.slice(-80) : [];
  setupEvents();
  renderMessages(); renderProject();
  if (!isDesktopApp() && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js').catch((error) => addLog('warning', 'Offline shell cache was not registered.', error.message));
    navigator.storage?.persist?.().catch(() => {});
  }
  window.addEventListener('error', (event) => addLog('error', event.message || 'Unexpected application error.', event.filename ? `${event.filename}:${event.lineno}` : ''));
  window.addEventListener('unhandledrejection', (event) => addLog('error', 'Unhandled application error.', event.reason?.message ?? String(event.reason)));
  await refreshStatuses();
  if (project.assets.length) {
    const missing = project.assets.filter((asset) => asset.missing).length;
    if (missing) toast('Some source media is missing', 'warning', 'Use Import media to relink or re-add the original files.');
  }
  if (nativeBridge()?.listen) {
    state.progressUnlisten = await listenNative('model-download-progress', updateModelDownloadNotice);
  }
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<div class="fatal-error"><b>NEXUS VIDEO STUDIO could not start</b><pre>${escapeHtml(error.message)}</pre></div>`;
});
