const iconPaths = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  download: '<path d="M12 3.5v11m0 0 4-4m-4 4-4-4"/><path d="M5 15.5v3A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
  queue: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".7"/><circle cx="4.5" cy="12" r=".7"/><circle cx="4.5" cy="18" r=".7"/>',
  'check-circle': '<circle cx="12" cy="12" r="8.5"/><path d="m8 12 2.7 2.7L16.5 9"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17M8 13h2m4 0h2m-8 4h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  folder: '<path d="M3.5 7A2 2 0 0 1 5.5 5h4l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/><path d="M3.5 10h17"/>',
  edit: '<path d="m15 5 4 4M4 20l4-.8L19.2 8a2.1 2.1 0 0 0-3-3L5 16.2 4 20Z"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  speed: '<path d="M4.2 17.8a9 9 0 1 1 15.6 0"/><path d="m12 13 4.4-4.4M7 18h10"/>',
  activity: '<path d="M3 12h4l2.2-6 4.1 12 2.2-6H21"/>',
  'hard-drive': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h18m-13 2h.01m4-.01h.01"/>',
  shield: '<path d="M12 21s7-3.5 7-9.5V5l-7-2-7 2v6.5C5 17.5 12 21 12 21Z"/><path d="m9 11.5 2 2 4-4"/>',
  zap: '<path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r=".7"/><circle cx="12" cy="12" r=".7"/><circle cx="19" cy="12" r=".7"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2"/>',
  grip: '<circle cx="8" cy="6" r=".7"/><circle cx="16" cy="6" r=".7"/><circle cx="8" cy="12" r=".7"/><circle cx="16" cy="12" r=".7"/><circle cx="8" cy="18" r=".7"/><circle cx="16" cy="18" r=".7"/>',
  file: '<path d="M6 3.5h8l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M14 3.5V8h4.5M8 13h8m-8 3h8"/>',
  video: '<rect x="3.5" y="5.5" width="13" height="13" rx="2"/><path d="m16.5 10 4-2v8l-4-2z"/><path d="m9 9 4.5 3-4.5 3z"/>',
  music: '<path d="M15 5v11.5a3.5 3.5 0 1 1-2-3.2V7l7-1.5v8.5a3.5 3.5 0 1 1-2-3.2V4Z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 2-2 6 5"/>',
  archive: '<path d="M4 4h16v4H4zM5 8v11a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8"/><path d="M10 12h4"/>',
  document: '<path d="M6 3.5h8l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M14 3.5V8h4.5M8 13h8m-8 3h8"/>',
  warning: '<path d="M10.3 4.5 2.8 18a1.8 1.8 0 0 0 1.6 2.7h15.2a1.8 1.8 0 0 0 1.6-2.7L13.7 4.5a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3.3h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  external: '<path d="M13 5h6v6m0-6-9 9"/><path d="M18 13v5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V7.5A1.5 1.5 0 0 1 6.5 6H12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  browser: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M7 6.7h.01m3 0h.01"/>',
  monitor: '<rect x="3.5" y="4" width="17" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  log: '<path d="M7 4h13M7 9h13M7 14h8M7 19h5"/><path d="M3.5 4h.01M3.5 9h.01M3.5 14h.01M3.5 19h.01"/>',
  check: '<path d="m5 12 4.3 4.3L19 6.5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  'file-down': '<path d="M6 3.5h8l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M14 3.5V8h4.5M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function formatBytes(value, decimals = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  let amount = Math.max(0, Number(value));
  if (amount < 1000) return `${Math.round(amount)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let unit = -1;
  while (amount >= 1000 && unit < units.length - 1) { amount /= 1000; unit += 1; }
  return `${amount.toFixed(decimals)} ${units[unit]}`;
}

function formatRate(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  return `${formatBytes(value)}/s`;
}

function formatDuration(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
  let seconds = Math.floor(Number(value));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function cleanPath(value = '') {
  const path = String(value || '');
  if (path.length <= 34) return path || 'Choose a folder';
  return `${path.slice(0, 12)}…${path.slice(-19)}`;
}

function deriveStats(downloads = []) {
  const stats = { active: 0, queued: 0, completed: 0, failed: 0, paused: 0, completedBytes: 0 };
  for (const entry of downloads) {
    if (['checking', 'downloading', 'pausing'].includes(entry.status)) stats.active += 1;
    else if (entry.status === 'queued') stats.queued += 1;
    else if (entry.status === 'completed') { stats.completed += 1; stats.completedBytes += entry.totalBytes || entry.downloadedBytes || 0; }
    else if (entry.status === 'failed') stats.failed += 1;
    else if (entry.status === 'paused') stats.paused += 1;
  }
  return stats;
}

function statusName(status) {
  return ({ checking: 'Checking', downloading: 'Downloading', pausing: 'Pausing', queued: 'Queued', paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped' })[status] || status;
}

function fileIconClass(fileName = '') {
  const ext = fileName.toLowerCase().split('.').pop();
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'].includes(ext)) return ['video', 'video'];
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return ['music', 'music'];
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return ['image', 'image'];
  if (['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return ['archive', 'archive'];
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext)) return ['document', 'document'];
  return ['file', ''];
}

function fileIcon(fileName = '') {
  const [name, className] = fileIconClass(fileName);
  return `<span class="file-type-icon ${className}">${icon(name, 19)}</span>`;
}

function isActive(entry) { return ['checking', 'downloading', 'pausing'].includes(entry.status); }
function visibleTextForSize(entry) {
  return entry.totalBytes == null ? `${formatBytes(entry.downloadedBytes)} downloaded · size not reported` : `${formatBytes(entry.downloadedBytes)} / ${formatBytes(entry.totalBytes)}`;
}

function actionButtons(entry) {
  if (isActive(entry)) {
    return `<button class="action-button" data-action="pause" data-id="${escapeHtml(entry.id)}">${icon('pause', 12)}Pause</button><button class="action-button danger" data-action="cancel" data-id="${escapeHtml(entry.id)}">${icon('close', 12)}Cancel</button>`;
  }
  if (entry.status === 'queued') {
    return `<button class="action-button primary" data-action="resume" data-id="${escapeHtml(entry.id)}">${icon('play', 12)}Start</button><button class="action-button danger" data-action="cancel" data-id="${escapeHtml(entry.id)}">${icon('close', 12)}Cancel</button>`;
  }
  if (entry.status === 'paused' || entry.status === 'failed') {
    return `<button class="action-button primary" data-action="resume" data-id="${escapeHtml(entry.id)}">${icon('play', 12)}${entry.status === 'failed' ? 'Retry' : 'Resume'}</button><button class="action-button danger" data-action="cancel" data-id="${escapeHtml(entry.id)}">${icon('close', 12)}Cancel</button>`;
  }
  if (entry.status === 'completed') {
    return `<button class="action-button primary" data-action="open-file" data-id="${escapeHtml(entry.id)}">${icon('external', 12)}Open</button><button class="action-button" data-action="show-folder" data-id="${escapeHtml(entry.id)}">${icon('folder', 12)}Folder</button><button class="action-button" data-action="remove" data-id="${escapeHtml(entry.id)}">${icon('close', 12)}Remove</button>`;
  }
  return `<button class="action-button" data-action="remove" data-id="${escapeHtml(entry.id)}">${icon('close', 12)}Remove</button>`;
}

function renderDownloadCard(entry, options = {}) {
  const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));
  const statusClass = `status-${escapeHtml(entry.status)}`;
  const progressClass = `${entry.status === 'completed' ? 'completed' : entry.status === 'paused' ? 'paused' : ''} ${entry.totalBytes == null && isActive(entry) ? 'indeterminate' : ''}`;
  const date = entry.completedAt ? new Date(entry.completedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const titleRow = `<div class="file-title-row"><strong class="file-title" title="${escapeHtml(entry.fileName)}">${escapeHtml(entry.fileName)}</strong><span class="status-badge ${statusClass}">${escapeHtml(statusName(entry.status))}</span>${options.queue ? `<select class="priority-select priority-${escapeHtml(entry.priority || 'normal')}" data-priority-id="${escapeHtml(entry.id)}" aria-label="Priority for ${escapeHtml(entry.fileName)}"><option value="high" ${entry.priority === 'high' ? 'selected' : ''}>High</option><option value="normal" ${!entry.priority || entry.priority === 'normal' ? 'selected' : ''}>Normal</option><option value="low" ${entry.priority === 'low' ? 'selected' : ''}>Low</option></select>` : ''}</div>`;
  const transferMessage = entry.statusMessage || (entry.status === 'queued' ? 'Waiting in queue' : '');
  let metrics = '';
  if (isActive(entry)) {
    metrics = `<span class="metric speed">${icon('speed', 12)}<strong>${formatRate(entry.speedBytesPerSecond)}</strong></span><span class="metric">${icon('activity', 12)}<strong>Avg ${formatRate(entry.averageSpeedBps)}</strong></span><span class="metric">${icon('clock', 12)}<strong>ETA ${formatDuration(entry.etaSeconds)}</strong></span><span class="metric connection-chip">${icon('zap', 12)}<strong>${entry.activeConnections || 0} / ${entry.effectiveConnections || entry.selectedConnections} connections</strong></span>`;
  } else if (entry.status === 'completed') {
    metrics = `<span class="metric">${icon('check-circle', 12)}<strong>${escapeHtml(entry.message || 'File size verified.')}</strong></span><span class="metric">${icon('clock', 12)}<strong>${escapeHtml(date)}</strong></span>`;
  } else if (entry.status === 'queued') {
    metrics = `<span class="metric">${icon('queue', 12)}<strong>Position ${Number(entry.queuePosition || 0) + 1}</strong></span><span class="metric"><strong>${escapeHtml((entry.priority || 'normal').toUpperCase())} PRIORITY</strong></span>`;
  } else if (entry.status === 'paused') {
    metrics = `<span class="metric">${icon('pause', 12)}<strong>${escapeHtml(transferMessage || 'Progress saved')}</strong></span>`;
  } else if (entry.status === 'checking') {
    metrics = `<span class="metric">${icon('globe', 12)}<strong>Checking server capabilities…</strong></span>`;
  }
  const fileSource = `${icon('globe', 11)}<span>${escapeHtml(entry.source || 'Direct HTTP/HTTPS')}</span>`;
  const details = entry.error && entry.status === 'failed' ? `<div class="download-error">${icon('warning', 13)}<span>${escapeHtml(entry.error)}</span></div>` : '';
  const draggable = options.queue && entry.status === 'queued' ? 'draggable="true"' : '';
  return `<article class="download-card ${options.queue ? 'queue-card' : ''}" data-card-id="${escapeHtml(entry.id)}" ${draggable}>
    <div class="download-main">${fileIcon(entry.fileName)}<div class="file-details">${titleRow}<div class="file-source">${fileSource}</div></div>${options.queue ? `<span class="drag-handle" aria-label="Drag to reorder">${icon('grip', 15)}</span>` : ''}</div>
    <div class="progress-area"><div class="progress-line"><strong>${visibleTextForSize(entry)}</strong><strong class="progress-percent">${entry.totalBytes == null ? (entry.downloadedBytes ? 'Size unknown' : 'Waiting for size') : `${Math.round(progress)}%`}</strong></div><div class="progress-track" role="progressbar" ${entry.totalBytes == null ? 'aria-valuetext="File size not reported; transfer activity only"' : `aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"`}><div class="progress-fill ${progressClass}" style="width:${entry.totalBytes == null ? '0%' : `${progress}%`}"></div></div></div>
    <div class="download-metrics">${metrics}</div>${details}<div class="download-actions">${actionButtons(entry)}${options.queue && entry.status === 'queued' ? `<span class="helper-line">Priority sorts first · drag to reorder</span>` : ''}</div>
  </article>`;
}

function renderEmpty({ title, description, button = true, small = false }) {
  return `<div class="empty-state ${small ? 'small' : ''}"><span class="empty-icon">${icon('file-down', 22)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${button ? `<button class="button button-primary button-small" data-action="open-add">${icon('plus', 14)}Add a download</button>` : ''}</div>`;
}

function bandwidthOptions(value, name, { custom = true } = {}) {
  const presets = [
    ['Unlimited', 'unlimited'], ['100 KB/s', '100000'], ['500 KB/s', '500000'], ['1 MB/s', '1000000'], ['5 MB/s', '5000000'], ['10 MB/s', '10000000'],
  ];
  const normalized = value == null ? 'unlimited' : String(value);
  const isPreset = presets.some(([, preset]) => preset === normalized);
  return `${presets.map(([label, preset]) => `<option value="${preset}" ${normalized === preset ? 'selected' : ''}>${label}</option>`).join('')}${custom && !isPreset ? `<option value="custom" selected>Custom</option>` : custom ? '<option value="custom">Custom</option>' : ''}`;
}

function bandwidthField(name, value, idPrefix) {
  const presets = [null, 100000, 500000, 1000000, 5000000, 10000000];
  const custom = value != null && !presets.includes(Number(value));
  return `<div class="field-group"><select class="select-field" name="${name}" data-bandwidth-select="${idPrefix}">${bandwidthOptions(value, name)}</select><input class="field" type="number" min="10" max="1000000000" step="10" name="${idPrefix}-custom" id="${idPrefix}-custom" value="${custom ? escapeHtml(value) : ''}" placeholder="Bytes/s" aria-label="Custom bandwidth in bytes per second" style="width:112px;${custom ? '' : 'display:none'}"></div>`;
}

function renderStat(iconName, label, value, caption, color = '') {
  return `<div class="stat-card ${color}"><span class="stat-icon">${icon(iconName, 18)}</span><div class="stat-copy"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(caption)}</small></div></div>`;
}

function pageHeading(kicker, title, subtitle, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1><p class="page-subtitle">${escapeHtml(subtitle)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function renderDashboard() {
  const downloads = appState.downloads || [];
  const active = downloads.filter((entry) => isActive(entry));
  const queued = downloads.filter((entry) => entry.status === 'queued').sort((a, b) => a.queuePosition - b.queuePosition).slice(0, 4);
  const stats = appState.stats || deriveStats(downloads);
  return `${pageHeading('OVERVIEW', 'Dashboard', 'Your downloads, queue and transfer health at a glance.', `<button class="button button-quiet" data-action="import-urls">${icon('upload', 14)}Import URLs</button><button class="button button-primary" data-action="open-add">${icon('plus', 14)}Add URL</button>`)}
    <section class="hero-banner"><span class="hero-icon">${icon('zap', 27)}</span><div class="hero-copy"><h2>Use your available internet speed more efficiently.</h2><p>When a server allows byte ranges, the engine can split files across a limited number of connections. It respects server responses, network conditions and your chosen bandwidth limit.</p><div class="hero-badges"><span class="hero-pill">${icon('shield', 12)}Direct &amp; permission-respecting</span><span class="hero-pill">${icon('refresh', 12)}Resume-ready transfers</span><span class="hero-pill">${icon('speed', 12)}Live speed from real bytes</span></div></div><div class="hero-mark"><strong>NO BANDWIDTH PROMISES</strong><small>No proxies · No limit bypasses</small></div></section>
    <div class="stats-grid">${renderStat('download', 'Active downloads', stats.active, stats.active ? 'Transferring or checking' : 'No active transfers')}${renderStat('queue', 'In the queue', stats.queued, 'Ready when you are', 'orange')}${renderStat('check-circle', 'Completed', stats.completed, 'Files verified by size', 'green')}${renderStat('hard-drive', 'Completed data', formatBytes(stats.completedBytes), 'Saved on this device', 'purple')}</div>
    <div class="content-grid"><section><div class="section-head"><div class="section-title"><h2>Active downloads</h2><span class="section-count">${stats.active}</span></div><div class="section-actions">${stats.active ? `<button class="text-button" data-action="pause-all">${icon('pause', 13)}Pause all</button>` : ''}<button class="text-button" data-nav="downloads">View downloads ${icon('arrow', 13)}</button></div></div>${active.length ? `<div class="download-list">${active.map((entry) => renderDownloadCard(entry)).join('')}</div>` : renderEmpty({ title: 'Nothing downloading right now', description: 'Add a direct HTTP or HTTPS link. The engine will check whether the server supports safe parallel ranges.', button: true })}
      <div class="honest-note">${icon('info', 14)}<span><strong>Realistic speed, always.</strong> Download speed depends on your internet connection, server bandwidth, network conditions, and whether the server supports parallel connections.</span></div></section>
      <section><div class="section-head"><div class="section-title"><h2>Up next</h2><span class="section-count">${stats.queued}</span></div><button class="text-button" data-nav="queue">Open queue ${icon('arrow', 13)}</button></div>${queued.length ? `<div class="queue-preview">${queued.map((entry, index) => `<div class="queue-preview-item"><span class="queue-position">${index + 1}</span>${fileIcon(entry.fileName)}<div class="queue-preview-copy"><strong>${escapeHtml(entry.fileName)}</strong><small>${escapeHtml(entry.source)} · ${(entry.priority || 'normal').toUpperCase()} priority</small></div><span>${entry.totalBytes == null ? 'Queued' : formatBytes(entry.totalBytes)}</span></div>`).join('')}</div>` : renderEmpty({ title: 'Queue is clear', description: 'Add downloads to the queue and decide when they should start.', button: false, small: true })}
      <div class="panel" style="margin-top:13px"><div class="panel-header"><div><h2>Transfer behavior</h2><p>Each download uses the source server directly.</p></div><span class="panel-icon green">${icon('shield', 16)}</span></div><div class="setting-copy"><strong>No access-control bypasses</strong><small>Authentication, paywalls, DRM and rate limits are respected. If ranges are not supported, the engine automatically falls back to one connection.</small></div><div style="margin-top:14px"><button class="text-button" data-nav="settings">Review settings ${icon('arrow', 13)}</button></div></div></section></div>`;
}

function renderDownloads() {
  const all = appState.downloads || [];
  const filtered = all.filter((entry) => {
    if (downloadFilter === 'active' && !isActive(entry)) return false;
    if (downloadFilter === 'queued' && entry.status !== 'queued') return false;
    if (downloadFilter === 'paused' && entry.status !== 'paused') return false;
    if (downloadFilter === 'completed' && entry.status !== 'completed') return false;
    if (downloadFilter === 'failed' && entry.status !== 'failed') return false;
    if (downloadSearch && !`${entry.fileName} ${entry.source}`.toLowerCase().includes(downloadSearch.toLowerCase())) return false;
    return true;
  });
  const filters = [['all', 'All'], ['active', 'Active'], ['queued', 'Queued'], ['paused', 'Paused'], ['completed', 'Completed'], ['failed', 'Failed']];
  return `${pageHeading('TRANSFERS', 'Downloads', 'Monitor real transfer progress, manage retries and continue where you left off.', `<button class="button button-quiet" data-action="pause-all">${icon('pause', 14)}Pause all</button><button class="button button-primary" data-action="open-add">${icon('plus', 14)}Add URL</button>`)}
    <div class="toolbar"><div class="filter-row">${filters.map(([key, label]) => `<button class="filter-button ${downloadFilter === key ? 'is-active' : ''}" data-filter="${key}">${label}${key === 'all' ? ` (${all.length})` : ''}</button>`).join('')}</div><label class="search-box">${icon('search', 14)}<input type="search" id="download-search" placeholder="Search downloads" value="${escapeHtml(downloadSearch)}" autocomplete="off"></label></div>
    ${filtered.length ? `<div class="download-list">${filtered.map((entry) => renderDownloadCard(entry)).join('')}</div>` : renderEmpty({ title: all.length ? 'No matching downloads' : 'No downloads yet', description: all.length ? 'Try another filter or search term.' : 'Paste one or more direct HTTP or HTTPS links to begin.', button: !all.length })}`;
}

function renderQueue() {
  const queued = (appState.downloads || []).filter((entry) => entry.status === 'queued').sort((a, b) => (a.priority === 'high' ? -1 : a.priority === 'low' ? 1 : 0) - (b.priority === 'high' ? -1 : b.priority === 'low' ? 1 : 0) || a.queuePosition - b.queuePosition);
  const active = (appState.downloads || []).filter(isActive);
  return `${pageHeading('CONTROL CENTER', 'Queue', 'Choose priorities, reorder pending downloads and run a manageable number at once.', `<button class="button button-quiet" data-action="pause-all">${icon('pause', 14)}Pause all</button><button class="button button-primary" data-action="resume-all">${icon('play', 14)}Resume all</button>`)}
    <div class="queue-callout">${icon('info', 14)}<span>Priority is applied before drag order. Active downloads are limited to <strong>${appState.settings?.maxActiveDownloads || 3}</strong> at a time.</span></div>
    <div class="section-head"><div class="section-title"><h2>Waiting downloads</h2><span class="section-count">${queued.length}</span></div><div class="queue-page-tools"><button class="button button-quiet button-small" data-action="cancel-all">${icon('close', 13)}Cancel all</button><button class="button button-primary button-small" data-action="open-add">${icon('plus', 13)}Add to queue</button></div></div>
    ${queued.length ? `<div class="download-list" id="queue-sort-list">${queued.map((entry) => renderDownloadCard(entry, { queue: true })).join('')}</div>` : renderEmpty({ title: 'No downloads waiting', description: active.length ? 'Your active downloads are using the available slots.' : 'New links added to the queue will appear here.', button: true })}
    ${active.length ? `<div style="margin-top:27px"><div class="section-head"><div class="section-title"><h2>Currently active</h2><span class="section-count">${active.length}</span></div></div><div class="download-list">${active.map((entry) => renderDownloadCard(entry)).join('')}</div></div>` : ''}`;
}

function renderCompleted() {
  const completed = (appState.downloads || []).filter((entry) => entry.status === 'completed');
  const completedSize = completed.reduce((total, entry) => total + (entry.totalBytes || entry.downloadedBytes || 0), 0);
  return `${pageHeading('LIBRARY', 'Completed', `${completed.length} verified file${completed.length === 1 ? '' : 's'} · ${formatBytes(completedSize)} saved on this device.`, `<button class="button button-quiet" data-action="import-urls">${icon('upload', 14)}Import URLs</button><button class="button button-primary" data-action="open-add">${icon('plus', 14)}Add URL</button>`)}
    ${completed.length ? `<div class="download-list">${completed.map((entry) => renderDownloadCard(entry)).join('')}</div>` : renderEmpty({ title: 'Your completed files will show up here', description: 'A download appears here only after its expected file size is verified and it has been safely promoted to the final filename.', button: true })}`;
}

function settingsTabs() {
  const tabs = [['general', 'General', 'settings'], ['downloads', 'Downloads', 'download'], ['browser', 'Browser integration', 'browser'], ['diagnostics', 'Diagnostics & logs', 'log']];
  return `<div class="settings-nav">${tabs.map(([id, label, iconName]) => `<button class="settings-tab ${settingsTab === id ? 'is-active' : ''}" data-settings-tab="${id}">${icon(iconName, 15)}${label}</button>`).join('')}</div>`;
}

function settingSwitch(name, checked, label) {
  return `<button class="switch" role="switch" aria-label="${escapeHtml(label)}" aria-checked="${checked ? 'true' : 'false'}" data-action="toggle-setting" data-setting="${name}"></button>`;
}

function renderGeneralSettings() {
  const settings = appState.settings || {};
  return `<form id="settings-form" data-settings-form>
    <section class="setting-section"><div class="setting-section-head"><div><h2>Storage</h2><p>Incomplete files stay in a .part file until integrity checks pass.</p></div><span class="panel-icon">${icon('folder', 16)}</span></div><div class="setting-section-body">
      <div class="setting-row"><div class="setting-copy"><strong>Download folder</strong><small>Choose where finished files and recovery metadata are stored.</small></div><div class="setting-control"><div class="field-group"><input class="field path-field" name="downloadDirectory" id="settings-download-dir" value="${escapeHtml(settings.downloadDirectory || '')}" autocomplete="off"><button class="button button-quiet button-small" type="button" data-action="browse-folder">Browse</button></div></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Organize completed files</strong><small>Move completed files into Videos, Music, Images, Documents, Archives, Software or Other.</small></div><div class="setting-control">${settingSwitch('autoOrganize', settings.autoOrganize, 'Automatically organize completed files')}</div></div>
    </div></section>
    <section class="setting-section"><div class="setting-section-head"><div><h2>Download behavior</h2><p>Keep connection counts and concurrent transfers within sensible limits.</p></div><span class="panel-icon purple">${icon('zap', 16)}</span></div><div class="setting-section-body">
      <div class="setting-row"><div class="setting-copy"><strong>Default connections per file</strong><small>Used only when the server supports byte-range requests. Adaptive control can reduce it after errors.</small></div><div class="setting-control"><select class="select-field" name="connections">${[1, 2, 4, 8, 16].map((n) => `<option value="${n}" ${Number(settings.connections) === n ? 'selected' : ''}>${n} connection${n === 1 ? '' : 's'}</option>`).join('')}</select></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Maximum active downloads</strong><small>Limits concurrent files separately from connections used by each file.</small></div><div class="setting-control"><select class="select-field" name="maxActiveDownloads">${[1,2,3,4,5,6,8,10].map((n) => `<option value="${n}" ${Number(settings.maxActiveDownloads) === n ? 'selected' : ''}>${n} active</option>`).join('')}</select></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Bandwidth limit</strong><small>Applied to the combined incoming download stream; bytes are throttled before disk writes.</small></div><div class="setting-control">${bandwidthField('bandwidthLimitBps', settings.bandwidthLimitBps, 'global-bandwidth')}</div></div>
    </div></section>
    <div class="disclaimer-card">${icon('info', 15)}<span><strong>Speed depends on the source.</strong> This app cannot increase your internet bandwidth or bypass ISP, server, authentication or rate limits. Parallel ranges can help use existing capacity when the server allows them.</span></div>
    <div class="settings-save-row"><button type="button" class="button button-primary button-small" data-action="save-settings">Save settings</button></div>
  </form>`;
}

function renderDownloadSettings() {
  return `<section class="setting-section"><div class="setting-section-head"><div><h2>Resilience &amp; integrity</h2><p>Recovery data is written alongside each partial file.</p></div><span class="panel-icon green">${icon('shield', 16)}</span></div><div class="setting-section-body">
    <div class="setting-row"><div class="setting-copy"><strong>Resume support</strong><small>Range-capable sources keep completed segment ranges and strong validators. Sources without ranges restart safely from byte zero.</small></div><div class="setting-control"><span class="browser-tag">AUTOMATIC</span></div></div>
    <div class="setting-row"><div class="setting-copy"><strong>Temporary filenames</strong><small>Incomplete data uses filename.ext.part and filename.ext.part.json. Final names are created only after verification.</small></div><div class="setting-control"><span class="browser-tag">.PART + SIDECAR</span></div></div>
    <div class="setting-row"><div class="setting-copy"><strong>Retry policy</strong><small>Segment-level exponential backoff with server Retry-After respected. Access-denied responses are never retried to bypass permissions.</small></div><div class="setting-control"><span class="browser-tag">AUTOMATIC</span></div></div>
    <div class="setting-row"><div class="setting-copy"><strong>Integrity checks</strong><small>Final size is checked; SHA-256, SHA-1 or MD5 is verified when supplied by the source.</small></div><div class="setting-control"><span class="browser-tag">BEFORE COMPLETE</span></div></div>
  </div></section>
  <section class="setting-section"><div class="setting-section-head"><div><h2>Network policy</h2><p>Privacy-first, direct HTTP/HTTPS transfers.</p></div><span class="panel-icon orange">${icon('globe', 16)}</span></div><div class="setting-section-body">
    <div class="setting-row"><div class="setting-copy"><strong>No proxy rotation</strong><small>The engine does not use unauthorized proxies, CAPTCHA bypasses, credential collection or browser history.</small></div><div class="setting-control"><span class="browser-tag">DIRECT ONLY</span></div></div>
    <div class="setting-row"><div class="setting-copy"><strong>Connection reuse</strong><small>Persistent HTTP/HTTPS agents are shared per origin where the server supports keep-alive.</small></div><div class="setting-control"><span class="browser-tag">KEEP-ALIVE</span></div></div>
  </div></section>`;
}

function renderBrowserSettings() {
  const desktop = Boolean(window.downloadManager?.isDesktop);
  return `<section class="setting-section"><div class="setting-section-head"><div><h2>Send links from your browser</h2><p>Explicit link handoff through native messaging — no browsing-history permission.</p></div><span class="panel-icon">${icon('browser', 16)}</span></div><div class="setting-section-body">
      <div class="browser-step"><b>1</b><span>Enable the native-messaging host for your Windows account. Chrome, Edge and Firefox are supported.</span></div>
      <div class="browser-step"><b>2</b><span>Load the included extension folder in your browser (or install the signed Firefox extension when distributed). Use the context menu on a link or click the extension action.</span></div>
      <div class="browser-step"><b>3</b><span>The extension sends only the link you explicitly select to the desktop app. It does not read page history or collect browsing activity.</span></div>
      <div class="browser-tags"><span class="browser-tag">CHROME</span><span class="browser-tag">EDGE</span><span class="browser-tag">FIREFOX</span><span class="browser-tag">NATIVE MESSAGING</span></div>
      <div class="browser-actions"><button class="button button-primary button-small" data-action="install-browser">${icon('check', 13)}${desktop ? 'Enable browser bridge' : 'Windows desktop required'}</button><button class="button button-quiet button-small" data-action="open-extension">${icon('folder', 13)}Open extension folder</button>${desktop ? '<button class="button button-quiet button-small" data-action="uninstall-browser">Disable bridge</button>' : ''}</div>
      ${!desktop ? '<p class="helper-line" style="margin-top:10px">The web preview cannot register Windows browser hosts. This control becomes active in the packaged desktop app.</p>' : ''}
  </div></section>
  <div class="disclaimer-card">${icon('shield', 15)}<span><strong>Local-only handoff.</strong> The native messaging host validates HTTP and HTTPS links and starts a download only after the browser sends an explicit user action. No credentials are collected or forwarded.</span></div>`;
}

function renderDiagnostics() {
  const logs = appState.logs || [];
  return `<section class="setting-section"><div class="setting-section-head"><div><h2>Diagnostics log</h2><p>Detailed local records for connection checks, retries and integrity verification.</p></div><div class="log-toolbar"><button class="button button-quiet button-small" data-action="refresh-logs">${icon('refresh', 13)}Refresh</button><button class="button button-primary button-small" data-action="export-logs">${icon('download', 13)}Export</button></div></div><div class="setting-section-body"><div class="log-list">${logs.length ? logs.map((row) => `<div class="log-row"><span class="log-time">${escapeHtml(new Date(row.timestamp).toLocaleTimeString())}</span><span class="log-level ${escapeHtml(row.level)}">${escapeHtml(row.level)}</span><span class="log-message">${escapeHtml(row.message)}${row.details?.fileName ? ` · ${escapeHtml(row.details.fileName)}` : ''}${row.details?.code ? ` · ${escapeHtml(row.details.code)}` : ''}</span></div>`).join('') : '<div class="empty-state small"><span class="empty-icon">' + icon('log', 18) + '</span><h3>No diagnostic entries yet</h3><p>Engine events will appear here as you add downloads.</p></div>'}</div><p class="helper-line" style="margin-top:9px">Sensitive URL query strings are redacted from diagnostic log entries.</p></div></section>`;
}

function renderSettings() {
  const sections = { general: renderGeneralSettings, downloads: renderDownloadSettings, browser: renderBrowserSettings, diagnostics: renderDiagnostics };
  return `${pageHeading('PREFERENCES', 'Settings', 'Configure storage, transfer behavior, browser handoff and diagnostics.')}
    <div class="settings-layout">${settingsTabs()}<div class="settings-main">${(sections[settingsTab] || renderGeneralSettings)()}</div></div>`;
}

function renderScheduler() {
  const schedule = appState.settings?.schedule || { enabled: false, startTime: '02:00', stopTime: '07:00', maxActiveDownloads: 3, bandwidthLimitBps: null };
  const active = appState.scheduleActive;
  const nextWindow = schedule.enabled ? (active ? 'Window is open now' : `Next window: ${schedule.startTime}–${schedule.stopTime}`) : 'Scheduler disabled';
  const queued = (appState.downloads || []).filter((entry) => entry.status === 'queued').length;
  const running = (appState.downloads || []).filter(isActive).length;
  return `${pageHeading('AUTOMATION', 'Scheduler', 'Set a daily window for queued downloads and choose its concurrency and bandwidth policy.')}
    <section class="scheduler-hero"><div class="scheduler-hero-copy"><span class="hero-icon">${icon('calendar', 23)}</span><div><h2>${schedule.enabled ? 'Your schedule is configured' : 'Schedule your downloads'}</h2><p>${escapeHtml(nextWindow)} · Your computer and the app must be awake for scheduled starts.</p></div></div><div class="setting-control">${settingSwitch('schedule.enabled', schedule.enabled, 'Enable scheduled downloads')}</div></section>
    <form id="schedule-form" data-schedule-form><section class="setting-section"><div class="setting-section-head"><div><h2>Daily time window</h2><p>Downloads are paused safely at the stop time and resume at the next start.</p></div><span class="panel-icon purple">${icon('clock', 16)}</span></div><div class="setting-section-body">
      <div class="setting-row"><div class="setting-copy"><strong>Start time</strong><small>Local time on this computer.</small></div><div class="setting-control"><input class="field" type="time" name="startTime" value="${escapeHtml(schedule.startTime || '02:00')}"></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Stop time</strong><small>Active transfers pause at this time without losing verified ranges.</small></div><div class="setting-control"><input class="field" type="time" name="stopTime" value="${escapeHtml(schedule.stopTime || '07:00')}"></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Maximum active downloads</strong><small>Controls simultaneous files during this window.</small></div><div class="setting-control"><select class="select-field" name="maxActiveDownloads">${[1,2,3,4,5,6,8,10].map((n) => `<option value="${n}" ${Number(schedule.maxActiveDownloads) === n ? 'selected' : ''}>${n} active</option>`).join('')}</select></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Bandwidth during schedule</strong><small>Unlimited is independent of your normal daytime limit.</small></div><div class="setting-control">${bandwidthField('bandwidthLimitBps', schedule.bandwidthLimitBps, 'schedule-bandwidth')}</div></div>
    </div></section><div class="settings-save-row" style="margin-top:12px"><button type="button" class="button button-primary button-small" data-action="save-schedule">Save schedule</button></div></form>
    <div class="scheduler-summary"><div class="scheduler-stat"><small>Schedule status</small><strong>${schedule.enabled ? (active ? 'Inside active window' : 'Waiting for next window') : 'Off'}</strong></div><div class="scheduler-stat"><small>Queue waiting</small><strong>${queued} file${queued === 1 ? '' : 's'}</strong></div><div class="scheduler-stat"><small>Currently running</small><strong>${running} file${running === 1 ? '' : 's'}</strong></div></div>
    <div class="disclaimer-card">${icon('info', 15)}<span>The scheduler uses local computer time and cannot wake a sleeping or powered-off computer. Downloads pause at the configured stop time; server rate limits continue to be respected.</span></div>`;
}

function renderCurrentPage() {
  if (!appState) return '<div class="loading-state"><div class="loading-box"><span class="loading-spinner"></span>Starting the local download engine…</div></div>';
  if (engineError) return `<div class="connection-warning">${icon('warning', 14)} ${escapeHtml(engineError)}</div>${renderEmpty({ title: 'The download engine is not connected', description: 'Start the AI Download Manager Pro desktop application or open its local preview service. The interface never simulates progress.', button: false })}`;
  switch (activeView) {
    case 'downloads': return renderDownloads();
    case 'queue': return renderQueue();
    case 'completed': return renderCompleted();
    case 'scheduler': return renderScheduler();
    case 'settings': return renderSettings();
    default: return renderDashboard();
  }
}

const content = document.getElementById('page-content');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
const importFileInput = document.getElementById('import-file-input');
let appState = null;
let engineError = '';
let activeView = 'dashboard';
let settingsTab = 'general';
let downloadFilter = 'all';
let downloadSearch = '';
let logsLoaded = false;
let eventUnsubscribe = null;
let dragId = null;
let interruptedPromptShown = false;
let modalUrls = '';

function updateChrome() {
  document.getElementById('page-breadcrumb').textContent = ({ dashboard: 'Dashboard', downloads: 'Downloads', queue: 'Queue', completed: 'Completed', scheduler: 'Scheduler', settings: 'Settings' })[activeView] || 'Dashboard';
  const stats = appState?.stats || deriveStats(appState?.downloads || []);
  document.getElementById('nav-active-count').textContent = stats.active;
  document.getElementById('nav-queue-count').textContent = stats.queued;
  document.getElementById('sidebar-download-path').textContent = cleanPath(appState?.settings?.downloadDirectory || 'Choose a folder');
  document.getElementById('sidebar-download-path').title = appState?.settings?.downloadDirectory || '';
  document.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('is-active', button.dataset.nav === activeView));
  content.innerHTML = renderCurrentPage();
  if (activeView === 'settings' && settingsTab === 'diagnostics' && !logsLoaded && !engineError) refreshLogs();
}

function isEditing() {
  const element = document.activeElement;
  return Boolean(element && content.contains(element) && /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
}

function refreshView({ force = false } = {}) {
  if (!force && (modalRoot.childElementCount || isEditing())) return;
  updateChrome();
}

function toast(title, message, level = 'success', timeout = 4200) {
  const node = document.createElement('div');
  node.className = `toast ${level === 'error' ? 'error' : level === 'warn' ? 'warn' : ''}`;
  node.innerHTML = `${icon(level === 'error' ? 'warning' : level === 'warn' ? 'info' : 'check-circle', 15)}<div class="toast-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
  toastRoot.append(node);
  setTimeout(() => node.remove(), timeout);
}

function applyState(next) {
  appState = next;
  engineError = '';
  if (appState && !appState.stats) appState.stats = deriveStats(appState.downloads || []);
  refreshView();
  maybePromptInterrupted();
}

function handleEngineEvent(event) {
  if (!event) return;
  if (event.type === 'state' && event.state) {
    applyState(event.state);
    return;
  }
  if (!appState) return;
  if (event.type === 'download-update' && event.download) {
    const index = appState.downloads.findIndex((entry) => entry.id === event.download.id);
    if (index >= 0) appState.downloads[index] = { ...appState.downloads[index], ...event.download };
    else appState.downloads.push(event.download);
    appState.stats = deriveStats(appState.downloads);
    refreshView();
  } else if (event.type === 'log' && event.entry) {
    appState.logs = [event.entry, ...(appState.logs || [])].slice(0, 200);
    if (activeView === 'settings' && settingsTab === 'diagnostics') refreshView();
  } else if (event.type === 'notification') {
    toast(event.title || 'Download update', event.message || '', event.level || 'success');
  } else if (event.type === 'schedule') {
    appState.scheduleActive = event.active;
    refreshView();
  }
}

function navigate(view) {
  if (!['dashboard', 'downloads', 'queue', 'completed', 'scheduler', 'settings'].includes(view)) return;
  activeView = view;
  document.getElementById('sidebar').classList.remove('mobile-open');
  if (view === 'settings') settingsTab = 'general';
  refreshView({ force: true });
}

function openAddModal(initial = '') {
  modalUrls = initial;
  const settings = appState?.settings || {};
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-dialog-title"><header class="modal-head"><div><h2 id="add-dialog-title">Add downloads</h2><p>Paste direct links below — one URL per line. Up to 100 links at once.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close', 16)}</button></header>
    <form id="add-form"><div class="modal-body"><label class="field-label" for="add-urls">Download URLs <small>HTTP / HTTPS</small></label><textarea class="url-textarea" id="add-urls" name="urls" placeholder="https://example.com/file.zip\nhttps://example.com/video.mp4" spellcheck="false" required>${escapeHtml(initial)}</textarea><div class="inline-hint">${icon('shield', 13)}<span>Links are fetched directly. Authentication, paywalls, DRM and server rate limits are not bypassed.</span></div>
      <button type="button" class="advanced-toggle" data-action="toggle-advanced">${icon('arrow', 13)}Advanced options</button><div class="advanced-fields" id="advanced-fields">
        <label class="form-field"><span class="field-label">Connections per file</span><select class="select-field" name="connections">${[1,2,4,8,16].map((n) => `<option value="${n}" ${Number(settings.connections) === n ? 'selected' : ''}>${n} connection${n === 1 ? '' : 's'}</option>`).join('')}</select></label>
        <label class="form-field"><span class="field-label">Priority</span><select class="select-field" name="priority"><option value="high">High</option><option value="normal" selected>Normal</option><option value="low">Low</option></select></label>
        <label class="form-field"><span class="field-label">If file exists</span><select class="select-field" name="duplicatePolicy"><option value="rename" selected>Rename new file</option><option value="replace">Replace after verification</option><option value="skip">Skip existing file</option><option value="resume">Resume matching partial</option></select></label>
        <div class="form-field"><span class="field-label">Save location</span><div class="field-group"><span class="helper-line" title="${escapeHtml(settings.downloadDirectory || '')}">${escapeHtml(cleanPath(settings.downloadDirectory || 'Choose a folder'))}</span><button class="button button-quiet button-small" type="button" data-action="browse-folder">Change</button></div></div>
      </div><div class="radio-row"><label class="radio-card"><input type="radio" name="startMode" value="start" checked><span><strong>Start immediately</strong><small>Use an available active slot.</small></span></label><label class="radio-card"><input type="radio" name="startMode" value="queue"><span><strong>Add to queue</strong><small>Wait until you choose Start.</small></span></label></div><div id="add-error" class="modal-error" role="alert"></div></div>
      <footer class="modal-footer"><span class="footer-left">Default connections: ${settings.connections || 8} · Maximum 16 per file</span><div class="modal-footer-actions"><button type="button" class="button button-quiet" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${icon('download', 14)}Add downloads</button></div></footer></form></section>`;
  modalRoot.replaceChildren(modal);
  setTimeout(() => document.getElementById('add-urls')?.focus(), 0);
}

function closeModal() {
  modalRoot.replaceChildren();
  refreshView({ force: true });
  maybePromptInterrupted();
}

function maybePromptInterrupted() {
  if (interruptedPromptShown || !appState?.interruptedCount || modalRoot.childElementCount) return;
  interruptedPromptShown = true;
  const interrupted = appState.downloads.filter((entry) => entry.status === 'paused' && entry.pauseReason === 'restart');
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="resume-dialog-title"><header class="modal-head"><div><p class="eyebrow">SESSION RECOVERY</p><h2 id="resume-dialog-title">Resume ${interrupted.length} interrupted download${interrupted.length === 1 ? '' : 's'}?</h2><p>Saved byte ranges are checked against the server before resuming. Files without range support restart safely.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close', 16)}</button></header><div class="modal-body"><div class="resume-list">${interrupted.slice(0, 6).map((entry) => `<div class="resume-item">${fileIcon(entry.fileName)}<div><strong>${escapeHtml(entry.fileName)}</strong><small>${formatBytes(entry.downloadedBytes)}${entry.totalBytes == null ? '' : ` of ${formatBytes(entry.totalBytes)}`} · ${escapeHtml(entry.source)}</small></div></div>`).join('')}${interrupted.length > 6 ? `<div class="helper-line">and ${interrupted.length - 6} more…</div>` : ''}</div></div><footer class="modal-footer"><span class="footer-left">Nothing resumes until you choose.</span><div class="modal-footer-actions"><button class="button button-quiet" data-action="close-modal">Not now</button><button class="button button-primary" data-action="resume-interrupted">${icon('play', 14)}Resume downloads</button></div></footer></section>`;
  modalRoot.replaceChildren(modal);
}

function setModalError(message) {
  const box = document.getElementById('add-error');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('visible', Boolean(message));
}

function parseUrlLines(text) {
  const candidates = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const valid = [];
  const invalid = [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      url.hash = '';
      valid.push(url.toString());
    } catch { invalid.push(candidate); }
  }
  return { valid: [...new Set(valid)], invalid };
}

function parseRate(form, selectName, customName) {
  const selected = form.elements.namedItem(selectName)?.value;
  if (selected === 'custom') {
    const custom = Number(form.elements.namedItem(customName)?.value);
    return Number.isFinite(custom) && custom >= 10_000 ? Math.round(custom) : null;
  }
  return selected === 'unlimited' || selected == null ? null : Number(selected);
}

async function submitAddForm(form) {
  const parsed = parseUrlLines(form.elements.namedItem('urls').value);
  if (!parsed.valid.length) return setModalError(parsed.invalid.length ? 'No valid HTTP or HTTPS links were found.' : 'Paste at least one download URL.');
  if (parsed.valid.length > 100) return setModalError('Add up to 100 URLs at a time. Split larger lists into batches.');
  if (parsed.invalid.length) return setModalError(`${parsed.invalid.length} invalid line${parsed.invalid.length === 1 ? '' : 's'} found. Fix or remove them before adding downloads.`);
  const options = {
    connections: Number(form.elements.namedItem('connections')?.value),
    priority: form.elements.namedItem('priority')?.value || 'normal',
    duplicatePolicy: form.elements.namedItem('duplicatePolicy')?.value || 'rename',
    startImmediately: form.elements.namedItem('startMode')?.value !== 'queue',
  };
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Adding…';
  let added = 0;
  let skipped = 0;
  const errors = [];
  for (const url of parsed.valid) {
    try {
      const result = await api.addDownload({ url, ...options });
      if (result?.skipped) skipped += 1;
      else added += 1;
    } catch (error) {
      errors.push(error.message || 'Could not add a URL.');
    }
  }
  if (errors.length) {
    setModalError(`${added} added${skipped ? `, ${skipped} skipped` : ''}. ${errors[0]}${errors.length > 1 ? ` (${errors.length - 1} more error${errors.length === 2 ? '' : 's'})` : ''}`);
    submitButton.disabled = false;
    submitButton.innerHTML = `${icon('download', 14)}Add downloads`;
    return;
  }
  closeModal();
  toast(options.startImmediately ? 'Downloads added' : 'Added to queue', `${added} link${added === 1 ? '' : 's'} added${skipped ? ` · ${skipped} skipped` : ''}.`, 'success');
  if (!options.startImmediately) navigate('queue');
}

async function handleImport() {
  try {
    const urls = await api.importUrls();
    if (Array.isArray(urls) && urls.length) {
      openAddModal(urls.join('\n'));
      return;
    }
    if (api.isDesktop) {
      toast('No links imported', 'Choose a text or CSV file containing one HTTP/HTTPS URL per line.', 'warn');
      return;
    }
    importFileInput.click();
  } catch (error) { toast('Import failed', error.message || 'Could not import URL list.', 'error'); }
}

async function onFileImport(event) {
  const files = [...(event.target.files || [])];
  event.target.value = '';
  const lines = [];
  for (const file of files) {
    try { lines.push(...(await file.text()).split(/\r?\n/)); } catch { /* ignore unreadable files */ }
  }
  const parsed = parseUrlLines(lines.join('\n'));
  if (!parsed.valid.length) return toast('No links found', 'The selected file did not contain valid HTTP/HTTPS URLs.', 'warn');
  openAddModal(parsed.valid.join('\n'));
}

async function changeFolder() {
  try {
    const selected = await api.chooseDownloadFolder();
    if (!selected) {
      if (!api.isDesktop) toast('Choose folder', 'Set an absolute download directory in Settings while using the local preview.', 'warn');
      return;
    }
    const settings = await api.updateSettings({ downloadDirectory: selected });
    appState.settings = settings;
    refreshView({ force: true });
    toast('Download location updated', selected);
  } catch (error) { toast('Folder not changed', error.message || 'Could not set the download folder.', 'error'); }
}

async function saveSettings() {
  const form = document.getElementById('settings-form');
  if (!form) return;
  const settings = {
    downloadDirectory: form.elements.namedItem('downloadDirectory').value.trim(),
    connections: Number(form.elements.namedItem('connections').value),
    maxActiveDownloads: Number(form.elements.namedItem('maxActiveDownloads').value),
    bandwidthLimitBps: parseRate(form, 'bandwidthLimitBps', 'global-bandwidth-custom'),
  };
  try {
    appState.settings = await api.updateSettings(settings);
    refreshView({ force: true });
    toast('Settings saved', 'New downloads will use these defaults.', 'success');
  } catch (error) { toast('Settings not saved', error.message || 'Could not apply settings.', 'error'); }
}

async function saveSchedule() {
  const form = document.getElementById('schedule-form');
  if (!form) return;
  const schedule = {
    ...(appState.settings?.schedule || {}),
    startTime: form.elements.namedItem('startTime').value,
    stopTime: form.elements.namedItem('stopTime').value,
    maxActiveDownloads: Number(form.elements.namedItem('maxActiveDownloads').value),
    bandwidthLimitBps: parseRate(form, 'bandwidthLimitBps', 'schedule-bandwidth-custom'),
  };
  try {
    appState.settings = await api.updateSettings({ schedule });
    refreshView({ force: true });
    toast('Schedule saved', 'The daily window is active if enabled.', 'success');
  } catch (error) { toast('Schedule not saved', error.message || 'Could not update the schedule.', 'error'); }
}

async function refreshLogs() {
  try {
    appState.logs = await api.getLogs(200);
    logsLoaded = true;
    refreshView({ force: true });
  } catch (error) { toast('Could not load logs', error.message || 'The diagnostics log is unavailable.', 'error'); }
}

async function exportLogs() {
  try {
    const filePath = await api.exportLogs();
    if (filePath) toast('Diagnostics exported', api.isDesktop ? filePath : 'Log file saved.', 'success');
  } catch (error) { toast('Export failed', error.message || 'Could not export logs.', 'error'); }
}

async function runAction(action, id) {
  try {
    if (action === 'pause') await api.pauseDownload(id);
    else if (action === 'resume') await api.resumeDownload(id);
    else if (action === 'cancel') await api.cancelDownload(id);
    else if (action === 'remove') await api.removeDownload(id);
    else if (action === 'open-file') await api.openFile(id);
    else if (action === 'show-folder') await api.showInFolder(id);
    else if (action === 'pause-all') { await api.pauseAll(); toast('Downloads paused', 'Active transfers are saving their current state.', 'success'); }
    else if (action === 'resume-all') { await api.resumeAll(); toast('Queue resumed', 'Eligible queued downloads will start within the active limit.', 'success'); }
    else if (action === 'cancel-all') {
      if (window.confirm('Cancel all unfinished downloads and remove their partial data? Completed files will remain untouched.')) {
        await api.cancelAll(); toast('Unfinished downloads cancelled', 'Partial temporary files were removed.', 'success');
      }
    } else if (action === 'resume-interrupted') {
      await api.resumeAll(); closeModal(); toast('Downloads resumed', 'The engine will re-check saved ranges before continuing.', 'success');
    } else if (action === 'import-urls') await handleImport();
    else if (action === 'open-add') openAddModal();
    else if (action === 'close-modal') closeModal();
    else if (action === 'toggle-advanced') {
      document.getElementById('advanced-fields')?.classList.toggle('open');
      document.querySelector('.advanced-toggle')?.classList.toggle('open');
    } else if (action === 'browse-folder') await changeFolder();
    else if (action === 'save-settings') await saveSettings();
    else if (action === 'save-schedule') await saveSchedule();
    else if (action === 'refresh-logs') { logsLoaded = false; await refreshLogs(); }
    else if (action === 'export-logs') await exportLogs();
    else if (action === 'install-browser') {
      const result = await api.installBrowserBridge();
      toast('Browser bridge enabled', `Native host registered. Extension folder: ${result.extensionDirectory || ''}`, 'success', 7000);
    } else if (action === 'open-extension') {
      const directory = await api.openExtensionFolder();
      if (directory) toast('Browser extension folder', directory, 'success');
    } else if (action === 'uninstall-browser') {
      await api.uninstallBrowserBridge();
      toast('Browser bridge disabled', 'Chrome, Edge and Firefox registry entries were removed for this Windows account.', 'success');
    } else if (action === 'toggle-sidebar') document.getElementById('sidebar').classList.toggle('mobile-open');
  } catch (error) {
    toast(action === 'resume' ? 'Could not resume' : 'Action failed', error.message || 'The request could not be completed.', 'error');
  }
}


async function toggleSetting(name, checked) {
  try {
    let patch;
    if (name === 'autoOrganize') patch = { autoOrganize: checked };
    else if (name === 'schedule.enabled') patch = { schedule: { ...(appState.settings?.schedule || {}), enabled: checked } };
    if (!patch) return;
    appState.settings = await api.updateSettings(patch);
    refreshView({ force: true });
    toast(checked ? 'Setting enabled' : 'Setting disabled', name === 'autoOrganize' ? 'Only newly completed files are affected.' : 'The scheduler state has been updated.', 'success');
  } catch (error) { toast('Setting not changed', error.message || 'Could not update the setting.', 'error'); }
}

function maybeOpenBrowserImport() { importFileInput.click(); }

function connectEvents() {
  if (typeof api.onEvent === 'function') eventUnsubscribe = api.onEvent(handleEngineEvent);
}

const appApi = window.downloadManager;
const api = appApi || createPreviewApi();

function createPreviewApi() {
  const post = async (action, body = {}) => {
    const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  };
  return {
    isDesktop: false,
    getState: () => fetch('/api/state').then(async (response) => { if (!response.ok) throw new Error('Local preview engine is unavailable.'); return response.json(); }),
    addDownload: (options) => post('add', options),
    pauseDownload: (id) => post('pause', { id }),
    resumeDownload: (id) => post('resume', { id }),
    cancelDownload: (id) => post('cancel', { id }),
    removeDownload: (id) => post('remove', { id }),
    pauseAll: () => post('pause-all'),
    resumeAll: () => post('resume-all'),
    cancelAll: () => post('cancel-all'),
    reorderQueue: (ids) => post('reorder', { ids }),
    setPriority: (id, priority) => post('priority', { id, priority }),
    updateSettings: (settings) => post('settings', settings),
    chooseDownloadFolder: async () => null,
    importUrls: async () => null,
    openFile: async () => { throw new Error('Open downloaded files from the Windows desktop app.'); },
    showInFolder: async () => { throw new Error('Folder reveal is available in the Windows desktop app.'); },
    getLogs: (limit) => fetch(`/api/logs?limit=${encodeURIComponent(limit || 200)}`).then((response) => response.json()),
    exportLogs: async () => {
      const text = await fetch('/api/logs/export').then((response) => response.text());
      const blob = new Blob([text], { type: 'text/plain' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'ai-download-manager.log'; link.click(); URL.revokeObjectURL(link.href); return 'ai-download-manager.log';
    },
    installBrowserBridge: async () => { throw new Error('Browser bridge registration is available in the packaged Windows desktop app.'); },
    uninstallBrowserBridge: async () => { throw new Error('Browser bridge registration is available in the packaged Windows desktop app.'); },
    openExtensionFolder: async () => { throw new Error('The web preview does not have access to local folders.'); },
    onEvent: (callback) => {
      const source = new EventSource('/api/events');
      source.onmessage = (message) => { try { callback(JSON.parse(message.data)); } catch { /* ignore malformed preview event */ } };
      source.onerror = () => { /* EventSource reconnects automatically. */ };
      return () => source.close();
    },
  };
}

// Event delegation survives content refreshes and keeps the renderer surface small.
document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { event.preventDefault(); navigate(nav.dataset.nav); return; }
  const settingsNav = event.target.closest('[data-settings-tab]');
  if (settingsNav) {
    settingsTab = settingsNav.dataset.settingsTab;
    refreshView({ force: true });
    if (settingsTab === 'diagnostics') { logsLoaded = false; await refreshLogs(); }
    return;
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) { downloadFilter = filter.dataset.filter; refreshView({ force: true }); return; }
  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  if (actionButton.dataset.action === 'toggle-setting') {
    const checked = actionButton.getAttribute('aria-checked') !== 'true';
    await toggleSetting(actionButton.dataset.setting, checked);
    return;
  }
  await runAction(actionButton.dataset.action, actionButton.dataset.id);
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'add-form') { event.preventDefault(); await submitAddForm(event.target); }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'download-search') {
    const current = event.target.value;
    downloadSearch = current;
    const position = event.target.selectionStart;
    const before = content.querySelector('#download-search');
    if (before) before.focus({ preventScroll: true });
    const matches = (appState?.downloads || []).filter((entry) => {
      if (downloadFilter === 'active' && !isActive(entry)) return false;
      if (downloadFilter === 'queued' && entry.status !== 'queued') return false;
      if (downloadFilter === 'paused' && entry.status !== 'paused') return false;
      if (downloadFilter === 'completed' && entry.status !== 'completed') return false;
      if (downloadFilter === 'failed' && entry.status !== 'failed') return false;
      return !current || `${entry.fileName} ${entry.source}`.toLowerCase().includes(current.toLowerCase());
    });
    const list = content.querySelector('.download-list');
    if (list) list.innerHTML = matches.length ? matches.map((entry) => renderDownloadCard(entry)).join('') : renderEmpty({ title: 'No matching downloads', description: 'Try another filter or search term.', button: false });
    const input = content.querySelector('#download-search');
    input?.setSelectionRange(position, position);
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-bandwidth-select]')) {
    const prefix = event.target.dataset.bandwidthSelect;
    const custom = document.getElementById(`${prefix}-custom`);
    if (custom) { custom.style.display = event.target.value === 'custom' ? '' : 'none'; if (event.target.value === 'custom') custom.focus(); }
  }
  if (event.target.matches('[data-priority-id]')) {
    const id = event.target.dataset.priorityId;
    try { await api.setPriority(id, event.target.value); toast('Priority updated', 'Queue priority order has been refreshed.', 'success'); }
    catch (error) { toast('Priority not changed', error.message || 'Could not update priority.', 'error'); }
  }
});

content.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.queue-card[draggable="true"]');
  if (!card) return;
  dragId = card.dataset.cardId;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragId);
});
content.addEventListener('dragend', () => {
  dragId = null;
  content.querySelectorAll('.dragging,.drag-over').forEach((card) => card.classList.remove('dragging', 'drag-over'));
});
content.addEventListener('dragover', (event) => {
  const card = event.target.closest('.queue-card[draggable="true"]');
  if (!card || card.dataset.cardId === dragId) return;
  event.preventDefault();
  content.querySelectorAll('.drag-over').forEach((other) => other.classList.remove('drag-over'));
  card.classList.add('drag-over');
});
content.addEventListener('drop', async (event) => {
  const target = event.target.closest('.queue-card[draggable="true"]');
  if (!target || !dragId || target.dataset.cardId === dragId) return;
  event.preventDefault();
  const list = document.getElementById('queue-sort-list');
  const source = list?.querySelector(`[data-card-id="${CSS.escape(dragId)}"]`);
  if (!source) return;
  const box = target.getBoundingClientRect();
  list.insertBefore(source, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
  const ids = [...list.querySelectorAll('[data-card-id]')].map((node) => node.dataset.cardId);
  try { await api.reorderQueue(ids); toast('Queue order saved', 'Priority still takes precedence over drag order.', 'success'); }
  catch (error) { toast('Queue order not saved', error.message || 'Could not reorder queue.', 'error'); }
});

importFileInput.addEventListener('change', onFileImport);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.childElementCount) closeModal();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); openAddModal(); }
});

async function initialize() {
  connectEvents();
  try {
    applyState(await api.getState());
  } catch (error) {
    engineError = error.message || 'Could not connect to the local download engine.';
    content.innerHTML = `<div class="connection-warning">${icon('warning', 14)} ${escapeHtml(engineError)}</div>${renderEmpty({ title: 'The download engine is not connected', description: 'Start the local app or its preview service to add and monitor real downloads. Progress is never simulated.', button: false })}`;
  }
}

initialize();
window.addEventListener('beforeunload', () => eventUnsubscribe?.());
