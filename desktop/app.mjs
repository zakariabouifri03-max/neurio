const PRESETS = [0, 102400, 512000, 1048576, 5242880, 10485760];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIVE = new Set(['downloading', 'checking', 'retrying']);
const QUEUE = new Set(['queued', 'scheduled', 'paused', 'failed', 'needs-attention']);
const state = { view: 'dashboard', snapshot: null, logs: [], speedHistory: [], modal: null, importBusy: false };
const mainView = document.querySelector('#main-view');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatBytes(value, precision = 1) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unknown size';
  const bytes = Math.max(0, Number(value));
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let amount = bytes / 1000;
  let index = 0;
  while (amount >= 1000 && index < units.length - 1) { amount /= 1000; index += 1; }
  return `${amount.toFixed(precision)} ${units[index]}`;
}

function formatRate(value) { return `${formatBytes(value, value >= 1e9 ? 2 : 1)}/s`; }
function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m ${String(secs).padStart(2, '0')}s`;
  return `${secs}s`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function shortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['mp4','mkv','mov','avi','webm','m4v'].includes(ext)) return ['video', '▶'];
  if (['pdf','doc','docx','txt','csv','xls','xlsx','ppt','pptx'].includes(ext)) return ['doc', '▤'];
  if (['zip','7z','rar','tar','gz','iso'].includes(ext)) return ['archive', '▧'];
  if (['mp3','wav','m4a','flac','ogg','aac'].includes(ext)) return ['music', '♫'];
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return ['image', '▧'];
  return ['', '↓'];
}

function statusLabel(status) {
  return ({
    queued: 'Queued', scheduled: 'Scheduled', paused: 'Paused', downloading: 'Downloading', retrying: 'Retrying',
    checking: 'Checking link', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped',
    'needs-attention': 'Needs attention',
  })[status] || status || 'Unknown';
}

async function invoke(action, payload = {}) {
  let result;
  if (window.aidmp?.invoke) {
    result = await window.aidmp.invoke(action, payload);
  } else {
    const routes = {
      state: ['GET', '/api/state'], logs: ['GET', `/api/logs?limit=${encodeURIComponent(payload.limit || 250)}`],
      inspect: ['POST', '/api/inspect'], add: ['POST', '/api/downloads'], addMany: ['POST', '/api/downloads/batch'],
      pauseAll: ['POST', '/api/actions/pause-all'], resumeAll: ['POST', '/api/actions/resume-all'], cancelAll: ['POST', '/api/actions/cancel-all'],
      updateSettings: ['PATCH', '/api/settings'], setSchedule: ['PUT', '/api/schedule'], reorder: ['POST', '/api/queue/reorder'],
      pause: ['POST', `/api/downloads/${encodeURIComponent(payload.id)}/pause`],
      resume: ['POST', `/api/downloads/${encodeURIComponent(payload.id)}/resume`],
      retry: ['POST', `/api/downloads/${encodeURIComponent(payload.id)}/retry`],
      cancel: ['POST', `/api/downloads/${encodeURIComponent(payload.id)}/cancel`],
      resolveDuplicate: ['POST', `/api/downloads/${encodeURIComponent(payload.id)}/duplicate`],
      setPriority: ['PATCH', `/api/downloads/${encodeURIComponent(payload.id)}/priority`],
      removeHistory: ['DELETE', `/api/downloads/${encodeURIComponent(payload.id)}`],
      clearLogs: ['DELETE', '/api/logs'],
      reveal: ['GET', `/api/downloads/${encodeURIComponent(payload.id)}/reveal`],
      chooseDirectory: ['POST', '/api/choose-directory'], openDirectory: ['POST', '/api/open-directory'], showInFolder: ['POST', '/api/show-in-folder'],
    };
    const route = routes[action];
    if (!route) throw new Error(`Unsupported application action: ${action}`);
    const [method, url] = route;
    const options = { method, headers: {} };
    if (!['GET', 'DELETE'].includes(method)) {
      options.headers['Content-Type'] = 'application/json';
      const body = action === 'updateSettings' ? payload.settings : action === 'setSchedule' ? payload.schedule : payload;
      options.body = JSON.stringify(body || {});
    }
    const response = await fetch(url, options);
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `Request failed (${response.status}).`);
    result = data;
  }
  if (result?.__aidmpError) throw new Error(result.message || 'The requested action could not be completed.');
  return result;
}

function showToast(message, kind = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  toastRoot.append(node);
  setTimeout(() => node.remove(), 3600);
}

function setEngineStatus(online = true) {
  const label = window.aidmp ? 'Desktop engine ready' : 'Live local engine';
  document.querySelector('#side-engine-status').textContent = online ? label : 'Reconnecting…';
  document.querySelector('#top-engine-status').textContent = online ? label : 'Reconnecting…';
  document.querySelectorAll('.connection-card .online-dot,.engine-pill .online-dot').forEach(dot => {
    dot.style.background = online ? 'var(--green)' : 'var(--amber)';
  });
}

let refreshTimer = null;
async function refresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      const next = await invoke('state');
      if (!next?.stats) return;
      state.snapshot = next;
      state.speedHistory.push({ time: Date.now(), speed: next.stats.currentSpeedBps || 0 });
      if (state.speedHistory.length > 42) state.speedHistory.shift();
      setEngineStatus(true);
      updateNavigationCounts();
      render();
      if (state.view === 'settings') await loadLogs(false);
    } catch (error) {
      setEngineStatus(false);
      if (!state.snapshot) {
        mainView.innerHTML = `<div class="panel empty-state"><div class="empty-icon">!</div><h3>Download engine unavailable</h3><p>${escapeHtml(error.message)} Restart the desktop application or development server and try again.</p></div>`;
      }
    }
  }, 75);
}

function updateNavigationCounts() {
  const stats = state.snapshot?.stats;
  if (!stats) return;
  document.querySelector('#nav-active-count').textContent = stats.activeDownloads;
  document.querySelector('#nav-queue-count').textContent = stats.queuedDownloads;
}

function render() {
  if (!state.snapshot) return;
  const titles = {
    dashboard: ['Dashboard', 'YOUR DOWNLOADS, IN CONTROL'], downloads: ['Downloads', 'LIVE TRANSFERS'], queue: ['Queue', 'PRIORITIES & ORDER'],
    completed: ['Completed', 'YOUR FINISHED FILES'], scheduler: ['Scheduler', 'AUTOMATE YOUR DOWNLOADS'], settings: ['Settings', 'PREFERENCES & DIAGNOSTICS'],
  };
  const [title, eyebrow] = titles[state.view] || titles.dashboard;
  document.querySelector('#top-title').textContent = title;
  document.querySelector('#top-eyebrow').textContent = eyebrow;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('selected', item.dataset.view === state.view));
  if (state.view === 'dashboard') mainView.innerHTML = renderDashboard();
  else if (state.view === 'downloads') mainView.innerHTML = renderDownloads();
  else if (state.view === 'queue') mainView.innerHTML = renderQueue();
  else if (state.view === 'completed') mainView.innerHTML = renderCompleted();
  else if (state.view === 'scheduler') mainView.innerHTML = renderScheduler();
  else mainView.innerHTML = renderSettings();
  attachViewHandlers();
}

function renderDashboard() {
  const { stats, downloads, queue } = state.snapshot;
  const current = downloads.filter(job => ACTIVE.has(job.status));
  const queued = queue.filter(job => !ACTIVE.has(job.status)).slice(0, 4);
  const maxActive = state.snapshot.settings?.schedule.enabled && state.snapshot.scheduler.insideWindow
    ? state.snapshot.settings.schedule.maxActiveDownloads : state.snapshot.settings?.maxActiveDownloads || 3;
  return `
    <section class="hero">
      <div class="hero-copy">
        <div class="hero-kicker"><span class="spark">✦</span> SMART, TRANSPARENT DOWNLOADS</div>
        <h2>Use your available internet speed more efficiently.</h2>
        <p>AI Download Manager Pro uses parallel HTTP byte ranges when a server allows them, and automatically falls back to a single connection when it does not. It cannot exceed your internet plan or the server’s limits.</p>
      </div>
      <div class="hero-action"><span class="online-dot"></span> Real transfers · No simulated speeds</div>
    </section>
    <section class="stats-grid">
      <div class="stat-card"><div class="stat-title">Current download speed</div><div class="stat-row"><div class="stat-value">${escapeHtml(formatRate(stats.currentSpeedBps))}</div><div class="stat-icon">↗</div></div></div>
      <div class="stat-card"><div class="stat-title">Active downloads</div><div class="stat-row"><div class="stat-value">${stats.activeDownloads}</div><span class="stat-unit">of ${maxActive} slots</span><div class="stat-icon green">⇩</div></div></div>
      <div class="stat-card"><div class="stat-title">Waiting in queue</div><div class="stat-row"><div class="stat-value">${stats.queuedDownloads}</div><span class="stat-unit">downloads</span><div class="stat-icon amber">☷</div></div></div>
      <div class="stat-card"><div class="stat-title">Completed</div><div class="stat-row"><div class="stat-value">${stats.completedDownloads}</div><span class="stat-unit">files</span><div class="stat-icon cyan">✓</div></div></div>
    </section>
    <section class="dashboard-grid">
      <div class="panel">
        <div class="panel-head"><h3 class="panel-title"><span class="title-mark"></span> Active downloads <span class="panel-caption">${current.length} in progress</span></h3><button class="text-button" data-nav="downloads">View all →</button></div>
        ${current.length ? `<div class="download-list">${current.slice(0, 4).map(renderDownloadCard).join('')}</div>` : emptyState('⇩', 'Nothing downloading right now', 'Add a link to start a real download. Compatible servers may provide safe parallel range requests.', 'Add URL', 'add-url-inline')}
        ${queued.length ? `<div class="queue-list">${queued.map(renderQueueRow).join('')}</div>` : ''}
      </div>
      <div class="panel chart-panel">
        <div class="panel-head"><h3 class="panel-title"><span class="title-mark"></span> Live performance</h3><span class="status-badge ${current.length ? 'downloading' : 'paused'}">${current.length ? 'Live' : 'Idle'}</span></div>
        <div class="chart-heading"><div><div class="chart-label">Current speed</div><div class="chart-current">${escapeHtml(formatRate(stats.currentSpeedBps))}<small>total</small></div></div><div class="chart-peak">Peak <b>${escapeHtml(formatRate(stats.peakSpeedBps))}</b></div></div>
        ${renderSpeedChart()}
        <div class="chart-footer"><span>Recent measured throughput</span><span>Average ${escapeHtml(formatRate(stats.averageSpeedBps))}</span></div>
        <div class="connection-summary"><div class="summary-cell"><small>Active connections</small><strong>${stats.activeConnections} connection${stats.activeConnections === 1 ? '' : 's'}</strong></div><div class="summary-cell"><small>Configured per download</small><strong>${state.snapshot.settings?.connections || 8} max</strong></div></div>
        <div class="truth-note"><span>ⓘ</span><div>Speed depends on your connection, the server, network conditions, and range support. Parallel connections never bypass rate limits.</div></div>
      </div>
    </section>`;
}

function renderSpeedChart() {
  const values = state.speedHistory.map(item => item.speed).slice(-36);
  const width = 420, height = 112, pad = 8;
  const max = Math.max(1, ...values);
  const points = values.length ? values.map((value, index) => {
    const x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
    const y = height - pad - (value / max) * (height - pad * 2);
    return [x, y];
  }) : [[pad, height - pad], [width - pad, height - pad]];
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1)[0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const current = points.at(-1);
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Recent real download throughput"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#7b8cff" stop-opacity=".42"/><stop offset="100%" stop-color="#7b8cff" stop-opacity="0"/></linearGradient></defs><path class="chart-grid" d="M0 28H${width} M0 58H${width} M0 88H${width}"/><path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/><circle class="chart-dot" cx="${current[0]}" cy="${current[1]}" r="4"/></svg>`;
}

function emptyState(icon, title, description, buttonLabel = '', action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${buttonLabel ? `<button class="button button-primary" data-action="${escapeHtml(action)}">${escapeHtml(buttonLabel)}</button>` : ''}</div>`;
}

function renderDownloadCard(job, compact = false) {
  const [kind, glyph] = fileKind(job.fileName);
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  const isActive = ACTIVE.has(job.status);
  const status = job.status;
  const details = job.size == null ? `${formatBytes(job.downloadedBytes)} downloaded · total size unknown` : `${formatBytes(job.downloadedBytes)} / ${formatBytes(job.size)}`;
  const speed = job.speedBps > 0 ? formatRate(job.speedBps) : '—';
  const avg = job.averageSpeedBps > 0 ? formatRate(job.averageSpeedBps) : '—';
  const eta = job.etaSeconds == null ? '—' : formatEta(job.etaSeconds);
  return `<article class="download-card" data-job-card="${escapeHtml(job.id)}">
    <div class="download-top"><div class="file-icon ${kind}">${glyph}</div><div class="download-name-wrap"><div class="download-name" title="${escapeHtml(job.fileName)}">${escapeHtml(job.fileName)}</div><div class="download-host">${escapeHtml(job.host || 'Preparing download')} · ${escapeHtml(job.category || 'Other')}</div></div><span class="status-badge ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span></div>
    ${status === 'needs-attention' ? renderDuplicateNotice(job) : ''}
    ${status === 'failed' && job.error ? `<div class="notice-card"><span class="notice-icon">!</span><div class="notice-body"><div class="notice-title">Download paused after an error</div><div class="notice-text">${escapeHtml(job.error.message)}</div></div></div>` : ''}
    <div class="progress-row"><div class="progress-track"><div class="progress-fill ${status === 'completed' ? 'complete' : ''}" style="width:${progress.toFixed(1)}%"></div></div><span class="progress-percent">${progress.toFixed(0)}%</span></div>
    <div class="download-meta"><span><strong>${escapeHtml(details)}</strong></span><span>Remaining ${job.remainingBytes == null ? '—' : escapeHtml(formatBytes(job.remainingBytes))}</span></div>
    <div class="download-metrics"><div class="download-metric"><span class="metric-dot"></span><b>${escapeHtml(speed)}</b></div><div class="download-metric">Avg <b>${escapeHtml(avg)}</b></div><div class="download-metric">ETA <b>${escapeHtml(eta)}</b></div><div class="download-metric">Connections <b>${job.activeConnections} / ${job.connectionLimit}</b></div>
    <div class="download-actions">${status === 'downloading' || status === 'checking' || status === 'retrying' ? `<button class="icon-button" title="Pause" aria-label="Pause" data-action="pause" data-id="${escapeHtml(job.id)}">Ⅱ</button>` : ['paused','failed','scheduled'].includes(status) ? `<button class="icon-button" title="Resume" aria-label="Resume" data-action="resume" data-id="${escapeHtml(job.id)}">▶</button>` : ''}${!['completed','cancelled','skipped','needs-attention'].includes(status) ? `<button class="icon-button danger" title="Cancel" aria-label="Cancel" data-action="cancel" data-id="${escapeHtml(job.id)}">×</button>` : ''}${status === 'completed' ? `<button class="icon-button" title="Show in folder" aria-label="Show in folder" data-action="reveal" data-id="${escapeHtml(job.id)}">↗</button>` : ''}</div></div>
    ${job.error && status !== 'failed' && status !== 'needs-attention' ? `<div class="secondary-line">${escapeHtml(job.error.message)}</div>` : ''}
  </article>`;
}

function renderDuplicateNotice(job) {
  const resumable = job.error?.code === 'DUPLICATE_PARTIAL';
  return `<div class="notice-card"><span class="notice-icon">!</span><div class="notice-body"><div class="notice-title">A destination conflict needs your choice</div><div class="notice-text">${escapeHtml(job.error?.message || 'Choose how to handle this file.')}</div></div><div class="notice-actions">${resumable ? `<button class="mini-action" data-action="duplicate-resume" data-id="${escapeHtml(job.id)}">Resume existing</button>` : ''}<button class="mini-action replace" data-action="duplicate-replace" data-id="${escapeHtml(job.id)}">Replace</button><button class="mini-action" data-action="duplicate-rename" data-id="${escapeHtml(job.id)}">Rename</button><button class="mini-action skip" data-action="duplicate-skip" data-id="${escapeHtml(job.id)}">Skip</button></div></div>`;
}

function renderQueueRow(job, draggable = false) {
  const status = statusLabel(job.status);
  return `<div class="queue-row" ${draggable ? `draggable="true" data-queue-id="${escapeHtml(job.id)}"` : ''}><span class="drag-handle" ${draggable ? 'title="Drag to reorder"' : ''}>⠿</span><div class="queue-name" title="${escapeHtml(job.fileName)}">${escapeHtml(job.fileName)}</div><span class="queue-size">${job.size == null ? '—' : escapeHtml(formatBytes(job.size))}</span><select class="queue-priority ${escapeHtml(job.priority)}" data-action="priority" data-id="${escapeHtml(job.id)}" aria-label="Priority for ${escapeHtml(job.fileName)}"><option value="low" ${job.priority === 'low' ? 'selected' : ''}>Low</option><option value="normal" ${job.priority === 'normal' ? 'selected' : ''}>Normal</option><option value="high" ${job.priority === 'high' ? 'selected' : ''}>High</option></select><span class="status-badge ${escapeHtml(job.status)}">${escapeHtml(status)}</span>${job.deferred && job.status==='queued' ? `<button class="icon-button" title="Start queued item" data-action="resume" data-id="${escapeHtml(job.id)}">▶</button>` : ''}${job.status==='failed' ? `<button class="icon-button" title="Retry" data-action="retry" data-id="${escapeHtml(job.id)}">↻</button>` : ''}${['paused','scheduled'].includes(job.status) ? `<button class="icon-button" title="Resume" data-action="resume" data-id="${escapeHtml(job.id)}">▶</button>` : ''}</div>`;
}

function renderDownloads() {
  const jobs = state.snapshot.downloads.filter(job => !['completed','cancelled','skipped'].includes(job.status));
  const activeCount = jobs.filter(job => ACTIVE.has(job.status)).length;
  return `<div class="view-heading"><div><h2>Downloads</h2><p>Live transfers, safe retries, and resumable progress.</p></div><div class="view-actions"><button class="button button-subtle" data-action="pause-all">Pause all</button><button class="button button-subtle" data-action="resume-all">Resume all</button><button class="button button-subtle" data-action="cancel-all">Cancel all</button></div></div>
    <div class="table-head panel"><strong>${activeCount} active · ${jobs.length} in progress or waiting</strong><span>Real bytes · no simulated progress</span></div>
    ${jobs.length ? `<div class="download-grid" style="margin-top:12px">${jobs.map(job => renderDownloadCard(job)).join('')}</div>` : `<div class="panel" style="margin-top:12px">${emptyState('⇩','No downloads yet','Paste a direct HTTP or HTTPS URL to inspect its size and range support before adding it.','Add URL','add-url-inline')}</div>`}`;
}

function renderQueue() {
  const jobs = state.snapshot.queue;
  return `<div class="view-heading"><div><h2>Queue</h2><p>Drag to reorder downloads. Set priority or start queued items at your pace.</p></div><div class="view-actions"><button class="button button-subtle" data-action="pause-all">Pause all</button><button class="button button-subtle" data-action="resume-all">Resume all</button><button class="button button-subtle" data-action="cancel-all">Cancel all</button></div></div>
    ${jobs.length ? `<div class="panel"><div class="table-head"><strong>${jobs.length} queued or paused</strong><span>Higher priority items start first</span></div><div class="queue-list" id="queue-sortable">${jobs.map(job => renderQueueRow(job, true)).join('')}</div></div>` : `<div class="panel">${emptyState('☷','Your queue is clear','Downloads waiting for a connection slot will appear here.','Add URL','add-url-inline')}</div>`}`;
}

function renderCompleted() {
  const jobs = state.snapshot.completed;
  return `<div class="view-heading"><div><h2>Completed</h2><p>Verified files are atomically moved from their temporary .part file into the final filename.</p></div><div class="view-actions"><button class="button button-subtle" data-action="open-download-folder">Open download folder</button></div></div>
    ${jobs.length ? `<div class="panel completed-list"><div class="table-head"><strong>${jobs.length} completed</strong><span>Size-verified${jobs.some(job => job.verifiedBy === 'size-and-checksum') ? ' · source checksum verified when supplied' : ''}</span></div>${jobs.map(job => { const [kind,glyph]=fileKind(job.fileName); return `<div class="download-card"><span class="complete-check">✓</span><div class="file-icon ${kind}">${glyph}</div><div class="completed-info"><div class="download-name">${escapeHtml(job.fileName)}</div><div class="download-host">${escapeHtml(job.host)} · ${escapeHtml(job.category)}</div></div><div class="completed-right"><span>${escapeHtml(formatBytes(job.size))}</span><span>${escapeHtml(shortDate(job.completedAt))}</span><button class="button-small" data-action="reveal" data-id="${escapeHtml(job.id)}">Show in folder</button><button class="danger-link" data-action="remove-history" data-id="${escapeHtml(job.id)}">Remove</button></div></div>`; }).join('')}</div>` : `<div class="panel">${emptyState('✓','No completed downloads yet','A download is only marked complete after the engine verifies the saved byte ranges and final file size.')}</div>`}`;
}

function bandwidthOptions(selected, prefix) {
  const opts = [[0,'Unlimited'],[102400,'100 KB/s'],[512000,'500 KB/s'],[1048576,'1 MB/s'],[5242880,'5 MB/s'],[10485760,'10 MB/s']];
  const isPreset = PRESETS.includes(Number(selected));
  return `<select class="select-field" id="${prefix}-bandwidth">${opts.map(([value,label]) => `<option value="${value}" ${Number(selected)===value?'selected':''}>${label}</option>`).join('')}<option value="custom" ${!isPreset?'selected':''}>Custom…</option></select><input class="field small ${isPreset?'hidden':''}" id="${prefix}-custom" type="number" min="1" step="1" placeholder="KB/s" value="${isPreset?'':Math.max(1,Math.round(Number(selected)/1024))}">`;
}

function renderScheduler() {
  const settings = state.snapshot.settings;
  const schedule = settings.schedule;
  const selectedDays = new Set(schedule.days || [0,1,2,3,4,5,6]);
  const active = schedule.enabled;
  return `<div class="view-heading"><div><h2>Scheduler</h2><p>Choose when downloads may run and set their schedule-specific concurrency and bandwidth.</p></div></div>
    <section class="panel scheduler-card"><div class="scheduler-top"><div><h2>Download schedule</h2><p>When the window opens, queued and schedule-paused downloads can continue. At the stop time, active downloads are safely paused and resumable.</p></div><div class="scheduler-state ${active?'on':''}"><span class="online-dot"></span>${active ? (state.snapshot.scheduler.insideWindow ? 'Schedule active' : 'Waiting for start') : 'Disabled'}</div></div>
      <div class="schedule-form"><div class="setting-row"><div class="setting-copy"><strong>Enable scheduler</strong><small>Automatically start queued downloads in the selected window.</small></div><button class="toggle ${active?'on':''}" id="schedule-enabled" aria-label="Toggle scheduler" aria-pressed="${active}"></button></div>
      <div class="schedule-grid"><div class="form-field"><label for="schedule-start">Start time</label><input class="field" id="schedule-start" type="time" value="${escapeHtml(schedule.startTime)}"></div><div class="form-field"><label for="schedule-stop">Stop time</label><input class="field" id="schedule-stop" type="time" value="${escapeHtml(schedule.stopTime)}"></div><div class="form-field"><label for="schedule-active">Maximum active downloads</label><select class="select-field" id="schedule-active">${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${n===schedule.maxActiveDownloads?'selected':''}>${n} download${n===1?'':'s'}</option>`).join('')}</select></div><div class="form-field"><label>Bandwidth limit</label><div>${bandwidthOptions(schedule.bandwidthLimitBps,'schedule')}</div></div></div>
      <div class="form-field" style="margin-top:16px"><label>Active days</label><div class="days-row">${DAY_LABELS.map((day,index)=>`<label class="day-chip"><input type="checkbox" name="schedule-day" value="${index}" ${selectedDays.has(index)?'checked':''}><span>${day}</span></label>`).join('')}</div></div>
      <div class="schedule-foot"><small>${active ? (state.snapshot.scheduler.insideWindow ? 'The schedule window is currently open.' : 'Queued items will wait until the next scheduled start.') : 'The queue runs normally while the scheduler is disabled.'}</small><button class="button button-primary" id="save-schedule">Save schedule</button></div></div></section>
      <div class="scheduler-note">Scheduler times use the Windows device’s local time. Downloads paused by the schedule keep their verified partial byte ranges when supported by the server.</div>`;
}

function renderSettings() {
  const settings = state.snapshot.settings;
  const bandwidthPreset = PRESETS.includes(Number(settings.bandwidthLimitBps));
  const logs = state.logs || [];
  return `<div class="view-heading"><div><h2>Settings</h2><p>Adjust connections, destination, bandwidth, organization, and diagnostics.</p></div></div>
    <div class="settings-layout"><div class="settings-stack">
      <section class="panel settings-section"><h3>Download behavior</h3><p>These limits apply to new downloads and the shared engine.</p>
        <div class="setting-row"><div class="setting-copy"><strong>Connections per download</strong><small>Parallel ranges are used only when the server supports them.</small></div><select class="select-field" id="settings-connections">${[1,2,4,8,16].map(n=>`<option value="${n}" ${n===settings.connections?'selected':''}>${n} connection${n===1?'':'s'}</option>`).join('')}</select></div>
        <div class="setting-row"><div class="setting-copy"><strong>Maximum active downloads</strong><small>Controls concurrent files, not internet bandwidth.</small></div><select class="select-field" id="settings-active">${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${n===settings.maxActiveDownloads?'selected':''}>${n} download${n===1?'':'s'}</option>`).join('')}</select></div>
        <div class="setting-row"><div class="setting-copy"><strong>Aggregate bandwidth limit</strong><small>Shared across all active downloads. The selected limit is enforced by the engine.</small></div><div class="setting-control">${bandwidthOptions(settings.bandwidthLimitBps,'main')}</div></div>
        <div class="schedule-foot"><small>Changes are saved to this Windows user profile.</small><button class="button button-primary" id="save-settings">Save settings</button></div>
      </section>
      <section class="panel settings-section"><h3>Save & organize</h3><p>Temporary files remain separate until verification succeeds.</p>
        <div class="setting-row"><div class="setting-copy"><strong>Download folder</strong><small>New files will be saved here.</small></div><div class="folder-field"><span class="folder-text" id="folder-path" title="${escapeHtml(settings.downloadDirectory)}">${escapeHtml(settings.downloadDirectory)}</span><button class="button-small" id="choose-folder">Choose…</button></div></div>
        <div class="setting-row"><div class="setting-copy"><strong>Organize by file type</strong><small>After completion, move files into Videos, Music, Images, Documents, Archives, Software, or Other.</small></div><button class="toggle ${settings.autoOrganize?'on':''}" id="auto-organize" aria-pressed="${settings.autoOrganize}" aria-label="Toggle automatic file organization"></button></div>
      </section>
      <section class="panel settings-section"><h3>Browser integration</h3><p>Send only links you explicitly choose. The extension uses browser Native Messaging; it does not read browsing history or open a local network port.</p><div class="setting-row"><div class="setting-copy"><strong>Chrome, Edge & Firefox</strong><small>Load the included browser-extension folder and register its native host using the included PowerShell helper.</small></div><span class="status-badge paused">Optional</span></div><div class="setting-row"><div class="setting-copy"><strong>Extension files</strong><small>See browser-extension/README.md for setup details.</small></div><button class="button-small" data-action="browser-help">Setup guide</button></div></section>
    </div>
    <div class="settings-stack">
      <section class="panel settings-section"><h3>Performance & integrity</h3><p>Trusted behavior, visible diagnostics, and no artificial speed claims.</p>
        <div class="truth-note" style="margin:0"><span>ⓘ</span><div>Download speed depends on your internet connection, server bandwidth, network conditions, and whether the server supports parallel connections. The app cannot bypass ISP or server limits.</div></div>
        <div class="setting-row"><div class="setting-copy"><strong>Temporary-file safety</strong><small>.part data and JSON range metadata are verified before final rename.</small></div><span class="complete-check">✓</span></div>
        <div class="setting-row"><div class="setting-copy"><strong>Connection reuse</strong><small>HTTP keep-alive agents reuse connections where supported.</small></div><span class="complete-check">✓</span></div>
      </section>
      <section class="panel"><div class="log-toolbar"><div><strong>Diagnostics · Logs</strong><div><small>Recent engine events and retry details</small></div></div><button class="button-small" data-action="clear-logs">Clear logs</button></div><div class="logs-panel">${logs.length ? logs.slice(-100).reverse().map(renderLogLine).join('') : `<div class="empty-state"><p>No diagnostics yet. Download events will appear here.</p></div>`}</div></section>
    </div></div>`;
}

function renderLogLine(line) {
  const match = /^(\S+) \[(INFO|WARN|ERROR)\] (.*)$/.exec(line);
  if (!match) return `<div class="log-line"><span class="log-message">${escapeHtml(line)}</span></div>`;
  return `<div class="log-line"><span class="log-time">${escapeHtml(new Date(match[1]).toLocaleTimeString())}</span><span class="log-level ${match[2].toLowerCase()}">${match[2]}</span><span class="log-message">${escapeHtml(match[3])}</span></div>`;
}

async function loadLogs(refreshView = true) {
  try { state.logs = await invoke('logs', { limit: 250 }); if (refreshView && state.view === 'settings') render(); }
  catch { state.logs = []; }
}

function attachViewHandlers() {
  mainView.querySelectorAll('[data-nav]').forEach(node => node.addEventListener('click', () => navigate(node.dataset.nav)));
  mainView.querySelectorAll('[data-action]').forEach(node => {
    const action = node.dataset.action;
    if (node.tagName === 'SELECT' && action === 'priority') node.addEventListener('change', () => runAction('setPriority', { id: node.dataset.id, priority: node.value }));
    else if (action === 'add-url-inline') node.addEventListener('click', openAddModal);
    else node.addEventListener('click', event => {
      event.stopPropagation();
      const id = node.dataset.id;
      const mapping = {
        pause: () => runAction('pause', { id }), resume: () => runAction('resume', { id }), retry: () => runAction('retry', { id }), cancel: () => confirmAction('Cancel this download and remove its temporary file?', () => runAction('cancel', { id })),
        'pause-all': () => runAction('pauseAll'), 'resume-all': () => runAction('resumeAll'), 'cancel-all': () => confirmAction('Cancel all unfinished downloads and remove their temporary files?', () => runAction('cancelAll')),
        'duplicate-replace': () => runAction('resolveDuplicate', { id, action: 'replace' }), 'duplicate-rename': () => runAction('resolveDuplicate', { id, action: 'rename' }), 'duplicate-skip': () => runAction('resolveDuplicate', { id, action: 'skip' }), 'duplicate-resume': () => runAction('resolveDuplicate', { id, action: 'resume' }),
        reveal: () => runAction('reveal', { id }), 'open-download-folder': () => runAction('openDirectory', { path: state.snapshot.settings.downloadDirectory }), 'remove-history': () => runAction('removeHistory', { id }), 'clear-logs': () => runAction('clearLogs').then(() => loadLogs()),
        'browser-help': () => openBrowserGuide(),
      };
      mapping[action]?.();
    });
  });
  const enable = document.querySelector('#schedule-enabled');
  if (enable) enable.addEventListener('click', () => { enable.classList.toggle('on'); enable.setAttribute('aria-pressed', enable.classList.contains('on')); });
  const saveSchedule = document.querySelector('#save-schedule');
  if (saveSchedule) saveSchedule.addEventListener('click', saveScheduleForm);
  const saveSettings = document.querySelector('#save-settings');
  if (saveSettings) saveSettings.addEventListener('click', saveSettingsForm);
  const org = document.querySelector('#auto-organize');
  if (org) org.addEventListener('click', async () => {
    try { await invoke('updateSettings', { settings: { autoOrganize: !state.snapshot.settings.autoOrganize } }); await refresh(); showToast('File organization preference saved.'); }
    catch (error) { showToast(error.message, 'error'); }
  });
  const folder = document.querySelector('#choose-folder');
  if (folder) folder.addEventListener('click', chooseFolder);
  bindCustomBandwidth('main');
  bindCustomBandwidth('schedule');
  bindQueueDrag();
}

async function runAction(action, payload = {}) {
  try {
    const result = await invoke(action, payload);
    if (action === 'reveal') {
      const job = state.snapshot.downloads.find(item => item.id === payload.id);
      if (window.aidmp && job?.finalPath) await invoke('showInFolder', { path: job.finalPath });
      else showToast(result ? `Download location: ${result}` : 'Download location unavailable.');
    } else if (action === 'openDirectory') {
      if (window.aidmp) await invoke('openDirectory', { path: payload.path });
      else showToast(`Download folder: ${payload.path}`);
    } else if (action === 'removeHistory') showToast('Completed item removed from the list.');
    else if (action === 'clearLogs') showToast('Diagnostics log cleared.');
    else if (action === 'resolveDuplicate') showToast('Duplicate-file choice saved.');
    else if (action === 'pauseAll') showToast('Active downloads paused.');
    else if (action === 'resumeAll') showToast('Eligible downloads resumed.');
    else if (action === 'cancelAll') showToast('Unfinished downloads cancelled.');
    else if (['pause','resume','retry','cancel'].includes(action)) showToast(action === 'cancel' ? 'Download cancelled.' : `Download ${action === 'pause' ? 'paused' : 'resumed'}.`);
    await refresh();
  } catch (error) { showToast(error.message, 'error'); }
}

function confirmAction(message, callback) {
  if (window.confirm(message)) callback();
}

function navigate(view) {
  state.view = view;
  render();
  if (view === 'settings') loadLogs();
  mainView.focus({ preventScroll: true });
}

function bindCustomBandwidth(prefix) {
  const select = document.querySelector(`#${prefix}-bandwidth`);
  const input = document.querySelector(`#${prefix}-custom`);
  if (!select || !input) return;
  select.addEventListener('change', () => input.classList.toggle('hidden', select.value !== 'custom'));
}

function readBandwidth(prefix) {
  const select = document.querySelector(`#${prefix}-bandwidth`);
  if (!select) return 0;
  if (select.value !== 'custom') return Number(select.value) || 0;
  const kb = Number(document.querySelector(`#${prefix}-custom`)?.value);
  if (!Number.isFinite(kb) || kb < 1) throw new Error('Enter a custom bandwidth limit of at least 1 KB/s.');
  return Math.floor(kb * 1024);
}

async function saveSettingsForm() {
  const settings = {
    connections: Number(document.querySelector('#settings-connections').value),
    maxActiveDownloads: Number(document.querySelector('#settings-active').value),
    bandwidthLimitBps: readBandwidth('main'),
  };
  try { await invoke('updateSettings', { settings }); await refresh(); showToast('Download settings saved.'); }
  catch (error) { showToast(error.message, 'error'); }
}

async function saveScheduleForm() {
  const schedule = {
    enabled: document.querySelector('#schedule-enabled').classList.contains('on'),
    startTime: document.querySelector('#schedule-start').value,
    stopTime: document.querySelector('#schedule-stop').value,
    days: [...document.querySelectorAll('input[name="schedule-day"]:checked')].map(input => Number(input.value)),
    maxActiveDownloads: Number(document.querySelector('#schedule-active').value),
    bandwidthLimitBps: readBandwidth('schedule'),
    pauseOutsideWindow: true,
  };
  try { await invoke('setSchedule', { schedule }); await refresh(); showToast('Schedule saved.'); }
  catch (error) { showToast(error.message, 'error'); }
}

async function chooseFolder() {
  try {
    let directory = await invoke('chooseDirectory');
    if (!directory && !window.aidmp) directory = window.prompt('Enter a download folder path:', state.snapshot.settings.downloadDirectory);
    if (!directory) return;
    await invoke('updateSettings', { settings: { downloadDirectory: directory } });
    await refresh();
    showToast('Download folder updated.');
  } catch (error) { showToast(error.message, 'error'); }
}

function bindQueueDrag() {
  const rows = [...document.querySelectorAll('[data-queue-id]')];
  let dragged = null;
  rows.forEach(row => {
    row.addEventListener('dragstart', () => { dragged = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', async () => {
      row.classList.remove('dragging');
      if (!dragged) return;
      const ids = [...document.querySelectorAll('[data-queue-id]')].map(item => item.dataset.queueId);
      dragged = null;
      try { await invoke('reorder', { ids }); await refresh(); } catch (error) { showToast(error.message, 'error'); }
    });
    row.addEventListener('dragover', event => {
      event.preventDefault();
      if (dragged && dragged !== row) {
        const box = row.getBoundingClientRect();
        row.parentNode.insertBefore(dragged, event.clientY < box.top + box.height / 2 ? row : row.nextSibling);
      }
    });
  });
}

function openModal(content) {
  modalRoot.innerHTML = `<div class="modal-backdrop" data-backdrop><section class="modal" role="dialog" aria-modal="true">${content}</section></div>`;
  modalRoot.querySelector('[data-backdrop]').addEventListener('click', event => { if (event.target.matches('[data-backdrop]')) closeModal(); });
  modalRoot.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
}
function closeModal() { modalRoot.innerHTML = ''; state.modal = null; }

function openAddModal(initialUrl = '') {
  state.modal = { url: initialUrl, inspected: null, conflictAction: null, inspecting: false, error: '' };
  renderAddModal();
}

function renderAddModal() {
  if (!state.modal) return;
  const m = state.modal;
  const info = m.inspected;
  const hasConflict = info && (info.targetExists || info.partialExists);
  openModal(`<div class="modal-head"><div><h2>Add a download</h2><p>Inspect a direct HTTP or HTTPS link before adding it.</p></div><button class="modal-close" data-close-modal aria-label="Close">×</button></div>
    <div class="modal-body"><form class="modal-form" id="inspect-form"><label for="modal-url">Download URL</label><div class="url-input-wrap"><input class="field" id="modal-url" type="url" placeholder="https://example.com/file.zip" required value="${escapeHtml(m.url)}"><button class="button button-subtle" type="submit" ${m.inspecting?'disabled':''}>${m.inspecting?'Inspecting…':'Inspect link'}</button></div></form>
    ${info ? `<div class="inspect-card"><div class="inspect-file"><div class="file-icon ${fileKind(info.fileName)[0]}">${fileKind(info.fileName)[1]}</div><div><div class="inspect-name">${escapeHtml(info.fileName)}</div><div class="inspect-sub">${escapeHtml(new URL(m.url).host)} · ${escapeHtml(info.contentType || 'Content type unknown')}</div></div></div><div class="inspect-facts"><span class="fact-pill">${escapeHtml(formatBytes(info.size))}</span><span class="fact-pill ${info.supportsRanges?'good':'neutral'}">${info.supportsRanges?'Byte ranges confirmed':'Single connection'}</span><span class="fact-pill ${info.validatorAvailable?'good':'neutral'}">${info.validatorAvailable?'Resume validator available':'No stable validator'}</span>${info.targetExists?'<span class="fact-pill neutral">Target already exists</span>':''}${info.partialExists?'<span class="fact-pill neutral">Temporary file exists</span>':''}</div><div class="inspect-note">${escapeHtml(info.note)}</div></div>` : ''}
    ${hasConflict ? `<div class="conflict-choice"><strong>Choose how to handle the existing destination</strong><div class="choice-row">${info.resumableDownloadId?`<button class="choice-pill" data-resume-existing="${escapeHtml(info.resumableDownloadId)}">${['checking','downloading','retrying'].includes(info.resumableStatus)?'Use existing download':'Resume existing download'}</button>`:''}<button class="choice-pill ${m.conflictAction==='replace'?'selected':''}" data-conflict="replace">Replace after verification</button><button class="choice-pill ${m.conflictAction==='rename'?'selected':''}" data-conflict="rename">Keep both · rename</button><button class="choice-pill ${m.conflictAction==='skip'?'selected':''}" data-conflict="skip">Skip</button></div></div>` : ''}
    ${m.error?`<div class="error-inline">${escapeHtml(m.error)}</div>`:''}
    <div class="priority-row"><label for="download-priority">Priority</label><select class="select-field" id="download-priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select><label style="margin-left:auto;display:flex;align-items:center;gap:7px"><input id="start-now" type="checkbox" checked> Start when a slot is free</label></div>
    </div><div class="modal-foot"><span class="foot-note">${info?.supportsRanges?'Parallel ranges are used only when verified and safe.':'Server and network limits are always respected.'}</span><div style="display:flex;gap:7px"><button class="button button-subtle" data-close-modal>Close</button><button class="button button-primary" id="confirm-add" ${!info||m.inspecting?'disabled':''}>${hasConflict?'Add with choice':'Add to downloads'}</button></div></div>`);
  const form = modalRoot.querySelector('#inspect-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const url = modalRoot.querySelector('#modal-url').value.trim();
    m.url = url; m.inspecting = true; m.error = ''; m.inspected = null; renderAddModal();
    try { m.inspected = await invoke('inspect', { url }); m.conflictAction = (m.inspected.targetExists || m.inspected.partialExists) ? null : 'ask'; }
    catch (error) { m.error = error.message; }
    finally { m.inspecting = false; renderAddModal(); }
  });
  modalRoot.querySelectorAll('[data-conflict]').forEach(button => button.addEventListener('click', () => { m.conflictAction = button.dataset.conflict; renderAddModal(); }));
  modalRoot.querySelector('[data-resume-existing]')?.addEventListener('click', async event => {
    try { await invoke('resume', { id: event.currentTarget.dataset.resumeExisting }); const alreadyRunning = ['checking','downloading','retrying'].includes(m.inspected?.resumableStatus); closeModal(); showToast(alreadyRunning ? 'The existing download is already running.' : 'Interrupted download resumed.'); await refresh(); }
    catch (error) { m.error = error.message; renderAddModal(); }
  });
  modalRoot.querySelector('#confirm-add')?.addEventListener('click', async () => {
    if (!m.inspected) return;
    const conflict = m.inspected.targetExists || m.inspected.partialExists;
    if (conflict && !m.conflictAction) { m.error = 'Choose Replace, Rename, Skip, or Resume existing before adding.'; renderAddModal(); return; }
    try {
      if (m.conflictAction === 'skip') { closeModal(); showToast('Download skipped.'); return; }
      await invoke('add', { url: m.url, fileName: m.inspected.fileName, priority: modalRoot.querySelector('#download-priority').value, conflictAction: m.conflictAction || 'ask', startNow: modalRoot.querySelector('#start-now').checked });
      closeModal(); navigate('downloads'); showToast('Download added to the queue.'); await refresh();
    } catch (error) { m.error = error.message; renderAddModal(); }
  });
  modalRoot.querySelector('#modal-url')?.focus();
}

function openBrowserGuide() {
  openModal(`<div class="modal-head"><div><h2>Browser integration setup</h2><p>Native Messaging · no localhost listening port</p></div><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><p class="inspect-note">Load the <b>browser-extension</b> folder as an unpacked extension in Chrome or Edge, copy its extension ID, then run the included <b>register-native-host.ps1</b> in PowerShell with that ID and the installed application path. Firefox uses the included extension ID. The extension only transmits links you explicitly choose and does not collect browsing history.</p><div class="scheduler-note">Full steps: browser-extension/README.md</div></div><div class="modal-foot"><span class="foot-note">The app inbox is stored in your per-user application data directory.</span><button class="button button-subtle" data-close-modal>Close</button></div>`);
}

async function importFiles(files) {
  if (state.importBusy || !files?.length) return;
  state.importBusy = true;
  const urls = [];
  for (const file of files) {
    const text = await file.text();
    for (const line of text.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate || candidate.startsWith('#')) continue;
      const first = candidate.split(/[\t, ]+/)[0];
      if (/^https?:\/\//i.test(first)) urls.push(first);
    }
  }
  const unique = [...new Set(urls)];
  if (!unique.length) { state.importBusy = false; showToast('No HTTP or HTTPS URLs were found in the selected file.', 'error'); return; }
  try {
    await invoke('addMany', { urls: unique, options: { priority: 'normal', conflictAction: 'ask', source: 'import' } });
    showToast(`${unique.length} URL${unique.length===1?'':'s'} added to the queue.`);
    navigate('queue');
    await refresh();
  } catch (error) { showToast(error.message, 'error'); }
  finally { state.importBusy = false; document.querySelector('#import-file').value = ''; }
}

function attachGlobalHandlers() {
  document.querySelector('#add-url').addEventListener('click', () => openAddModal());
  document.querySelector('#import-urls').addEventListener('click', () => document.querySelector('#import-file').click());
  document.querySelector('#import-file').addEventListener('change', event => importFiles([...event.target.files]));
  document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => navigate(item.dataset.view)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modalRoot.firstElementChild) closeModal();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); openAddModal(); }
  });
}

function subscribe() {
  if (window.aidmp?.onEvent) {
    window.aidmp.onEvent(event => {
      if (event?.type === 'log-entry' && typeof event.line === 'string') state.logs.push(event.line);
      refresh();
    });
    return;
  }
  const source = new EventSource('/api/events');
  source.onmessage = () => refresh();
  source.onerror = () => setEngineStatus(false);
}

async function initialize() {
  attachGlobalHandlers();
  try {
    state.snapshot = await invoke('state');
    setEngineStatus(true);
    render();
    subscribe();
    await loadLogs(false);
    setInterval(() => { if (state.view !== 'settings') refresh(); }, 1000);
  } catch (error) {
    setEngineStatus(false);
    mainView.innerHTML = `<div class="panel empty-state"><div class="empty-icon">!</div><h3>Could not connect to the download engine</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

initialize();
