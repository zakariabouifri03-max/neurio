"""Live Studio — camera-based virtual try-on page.

Served at http://localhost:8000/live

Opens the webcam, shows a Pinterest-style garment catalog, and lets you
try any garment on your live camera feed. No photo upload needed.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

LIVE_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>Anywear AI — Live Studio</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --ink:#111114; --soft:#3a3a40; --muted:#8a8a92; --mist:#f6f6f7; --line:#e8e8ec; --white:#fff; }
body { font-family: Inter, system-ui, -apple-system, sans-serif; background: var(--mist); color: var(--ink); overflow: hidden; height: 100vh; }

/* Layout */
.app { display: grid; grid-template-columns: 1fr 420px; height: 100vh; }
@media (max-width: 900px) { .app { grid-template-columns: 1fr; grid-template-rows: 1fr 400px; } }

/* Left: camera + result */
.stage { position: relative; background: #0a0a0c; display: flex; flex-direction: column; }
.stage-header { padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,.3); }
.stage-header .logo { display: flex; align-items: center; gap: 10px; color: #fff; }
.stage-header .logo svg { width: 28px; height: 28px; }
.stage-header .logo b { font-size: 15px; font-weight: 700; }
.stage-header .status { font-size: 12px; color: rgba(255,255,255,.7); }
.stage-header .status.live { color: #4ade80; }
.stage-header .status.error { color: #f87171; }

.video-wrap { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; }
video, canvas.result { width: 100%; height: 100%; object-fit: contain; }
canvas.result { position: absolute; inset: 0; }

.overlay-ui { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; z-index: 10; }
.btn { border: none; border-radius: 999px; padding: 12px 28px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .2s; display: flex; align-items: center; gap: 8px; }
.btn-primary { background: var(--ink); color: #fff; }
.btn-primary:hover { opacity: .85; transform: scale(1.02); }
.btn-primary:disabled { opacity: .4; cursor: not-allowed; transform: none; }
.btn-ghost { background: rgba(255,255,255,.12); color: #fff; backdrop-filter: blur(10px); }
.btn-ghost:hover { background: rgba(255,255,255,.2); }
.btn-danger { background: #ef4444; color: #fff; }

.progress-ring { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 64px; height: 64px; z-index: 5; display: none; }
.progress-ring.show { display: block; }
.progress-ring svg { transform: rotate(-90deg); }
.progress-ring circle { fill: none; stroke-width: 4; }
.progress-ring .bg { stroke: rgba(255,255,255,.2); }
.progress-ring .fg { stroke: #fff; stroke-linecap: round; transition: stroke-dashoffset .3s; }

.result-bar { position: absolute; top: 14px; right: 20px; z-index: 10; display: flex; gap: 8px; }
.result-bar .btn { padding: 8px 16px; font-size: 12px; }

.placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: rgba(255,255,255,.5); gap: 16px; text-align: center; padding: 20px; }
.placeholder svg { width: 64px; height: 64px; opacity: .4; }
.placeholder h2 { font-size: 18px; font-weight: 600; color: rgba(255,255,255,.7); }
.placeholder p { font-size: 13px; max-width: 300px; line-height: 1.5; }

/* Right: catalog */
.catalog { background: var(--white); border-left: 1px solid var(--line); display: flex; flex-direction: column; }
@media (max-width: 900px) { .catalog { border-left: none; border-top: 1px solid var(--line); } }
.catalog-header { padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; }
.catalog-header h2 { font-size: 16px; font-weight: 700; }
.catalog-header .count { font-size: 12px; color: var(--muted); }
.filters { display: flex; gap: 6px; flex-wrap: wrap; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.filter-chip { padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 500; cursor: pointer; transition: all .15s; background: var(--mist); color: var(--soft); border: 1px solid transparent; }
.filter-chip:hover { background: var(--line); }
.filter-chip.active { background: var(--ink); color: #fff; }

.grid-scroll { flex: 1; overflow-y: auto; padding: 16px; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.grid-item { border-radius: 12px; overflow: hidden; cursor: pointer; position: relative; background: var(--mist); transition: transform .15s, box-shadow .15s; }
.grid-item:hover { transform: scale(1.03); box-shadow: 0 4px 16px rgba(0,0,0,.1); }
.grid-item.selected { ring: 2px solid var(--ink); box-shadow: 0 0 0 2px var(--ink); }
.grid-item img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
.grid-item .label { padding: 8px 10px; font-size: 11px; font-weight: 500; background: #fff; }
.grid-item .label .cat { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }

/* Toast */
.toast { position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(100px); background: var(--ink); color: #fff; padding: 12px 24px; border-radius: 12px; font-size: 13px; font-weight: 500; z-index: 100; transition: transform .3s cubic-bezier(.16,1,.3,1); box-shadow: 0 8px 32px rgba(0,0,0,.3); }
.toast.show { transform: translateX(-50%) translateY(0); }
.toast.error { background: #ef4444; }
.toast.success { background: #22c55e; }

/* Loading overlay on grid items */
.grid-item.loading::after { content: ''; position: absolute; inset: 0; background: rgba(255,255,255,.6); backdrop-filter: blur(2px); }
.grid-item .spinner { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 28px; height: 28px; border: 3px solid rgba(0,0,0,.1); border-top-color: var(--ink); border-radius: 50%; animation: spin .8s linear infinite; display: none; }
.grid-item.loading .spinner { display: block; }
@keyframes spin { to { transform: translate(-50%,-50%) rotate(360deg); } }
</style>
</head>
<body>
<div class="app">
  <!-- LEFT: camera stage -->
  <div class="stage">
    <div class="stage-header">
      <div class="logo">
        <svg viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="16" fill="#111114"/><path d="M32 17L21 46" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M32 17L43 46" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M24.5 36.5L39.5 36.5" stroke="#e8e6e1" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="49" r="3.4" fill="#fff"/></svg>
        <b>Anywear AI — Live Studio</b>
      </div>
      <div class="status" id="status">Camera off</div>
    </div>
    <div class="video-wrap" id="videoWrap">
      <div class="placeholder" id="placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 7l-7 5 7 5V7z" stroke-linejoin="round"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        <h2>Start your camera</h2>
        <p>Click "Enable Camera" to begin live try-on. Point your camera at yourself, then pick a garment from the right.</p>
      </div>
      <video id="video" autoplay playsinline muted style="display:none"></video>
      <canvas class="result" id="resultCanvas" style="display:none"></canvas>
      <div class="progress-ring" id="progressRing">
        <svg width="64" height="64">
          <circle class="bg" cx="32" cy="32" r="28"/>
          <circle class="fg" cx="32" cy="32" r="28" stroke-dasharray="175.9" stroke-dashoffset="175.9" id="progressCircle"/>
        </svg>
      </div>
      <div class="overlay-ui">
        <button class="btn btn-primary" id="enableBtn" onclick="enableCamera()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z" stroke-linejoin="round"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          Enable Camera
        </button>
        <button class="btn btn-danger" id="stopBtn" onclick="stopCamera()" style="display:none">Stop</button>
      </div>
      <div class="result-bar" id="resultBar" style="display:none">
        <button class="btn btn-ghost" onclick="downloadResult()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Download
        </button>
        <button class="btn btn-ghost" onclick="clearResult()">Clear</button>
      </div>
    </div>
  </div>

  <!-- RIGHT: garment catalog -->
  <div class="catalog">
    <div class="catalog-header">
      <h2>Garments</h2>
      <span class="count" id="count">Loading…</span>
    </div>
    <div class="filters" id="filters"></div>
    <div class="grid-scroll">
      <div class="grid" id="grid"></div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = window.location.origin;
let stream = null;
let garments = [];
let activeFilter = 'all';
let selectedGarment = null;
let resultUrl = null;
let capturedFrame = null;

const video = document.getElementById('video');
const canvas = document.getElementById('resultCanvas');
const ctx = canvas.getContext('2d');
const placeholder = document.getElementById('placeholder');
const statusEl = document.getElementById('status');
const grid = document.getElementById('grid');
const countEl = document.getElementById('count');
const filtersEl = document.getElementById('filters');
const toastEl = document.getElementById('toast');
const progressRing = document.getElementById('progressRing');
const progressCircle = document.getElementById('progressCircle');

function showToast(msg, tone='') {
  toastEl.textContent = msg;
  toastEl.className = 'toast show ' + tone;
  setTimeout(() => toastEl.classList.remove('show'), 3500);
}

function setStatus(text, cls='') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

async function enableCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
    video.srcObject = stream;
    video.style.display = 'block';
    placeholder.style.display = 'none';
    document.getElementById('enableBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'flex';
    setStatus('Camera live', 'live');
    showToast('Camera ready — pick a garment to try on', 'success');
  } catch (e) {
    setStatus('Camera error', 'error');
    showToast('Could not access camera: ' + e.message, 'error');
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.style.display = 'none';
  placeholder.style.display = 'flex';
  document.getElementById('enableBtn').style.display = 'flex';
  document.getElementById('stopBtn').style.display = 'none';
  setStatus('Camera off');
  clearResult();
}

async function loadGarments() {
  try {
    const resp = await fetch(API + '/demo/garments');
    garments = await resp.json();
    countEl.textContent = garments.length + ' items';
    renderFilters();
    renderGrid();
  } catch (e) {
    countEl.textContent = 'Failed to load';
    showToast('Failed to load garment catalog', 'error');
  }
}

function renderFilters() {
  const cats = ['all', ...new Set(garments.map(g => g.category))];
  filtersEl.innerHTML = cats.map(c =>
    `<div class="filter-chip ${c===activeFilter?'active':''}" onclick="setFilter('${c}')">${c[0].toUpperCase()+c.slice(1)}</div>`
  ).join('');
}

function setFilter(cat) {
  activeFilter = cat;
  renderFilters();
  renderGrid();
}

function renderGrid() {
  const filtered = activeFilter === 'all' ? garments : garments.filter(g => g.category === activeFilter);
  grid.innerHTML = filtered.map(g => `
    <div class="grid-item" data-id="${g.id}" onclick="tryOn('${g.id}')">
      <img src="${API}${g.image}" alt="${g.name}" loading="lazy" />
      <div class="label"><div>${g.name}</div><div class="cat">${g.category}</div></div>
      <div class="spinner"></div>
    </div>
  `).join('');
}

function captureFrame() {
  if (!video.videoWidth) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  capturedFrame = document.createElement('canvas');
  capturedFrame.width = w;
  capturedFrame.height = h;
  capturedFrame.getContext('2d').drawImage(video, 0, 0, w, h);
  return capturedFrame;
}

async function tryOn(garmentId) {
  const garment = garments.find(g => g.id === garmentId);
  if (!garment) return;

  // Must have camera on
  if (!stream) {
    showToast('Enable your camera first', 'error');
    return;
  }

  const item = grid.querySelector(`[data-id="${garmentId}"]`);
  item.classList.add('loading');

  try {
    // Capture frame
    const frame = captureFrame();
    if (!frame) { showToast('Could not capture frame', 'error'); item.classList.remove('loading'); return; }
    const frameBlob = await new Promise(r => frame.toBlob(r, 'image/jpeg', 0.85));
    const frameFile = new File([frameBlob], 'camera.jpg', { type: 'image/jpeg' });

    // Fetch garment image
    const gResp = await fetch(API + garment.image);
    const gBlob = await gResp.blob();
    const gFile = new File([gBlob], garment.category + '.png', { type: 'image/png' });

    // Show progress
    progressRing.classList.add('show');
    setProgress(20);

    // Submit try-on
    const form = new FormData();
    form.append('person', frameFile);
    form.append('garment', gFile);
    form.append('category', garment.category);

    const resp = await fetch(API + '/api/tryon', { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || 'HTTP ' + resp.status);
    }
    const job = await resp.json();
    setProgress(50);

    // Poll for result
    let status = await pollJob(job.job_id);
    setProgress(80);

    if (status.status === 'succeeded') {
      const url = API + status.result_url;
      await loadResultImage(url);
      showToast('Try-on ready!', 'success');
    } else {
      throw new Error(status.error || 'Generation failed');
    }
  } catch (e) {
    showToast(e.message || 'Try-on failed', 'error');
  } finally {
    item.classList.remove('loading');
    progressRing.classList.remove('show');
  }
}

function setProgress(pct) {
  const circ = 2 * Math.PI * 28;
  progressCircle.style.strokeDashoffset = circ * (1 - pct / 100);
}

async function pollJob(jobId) {
  for (let i = 0; i < 80; i++) {
    await sleep(1500);
    const resp = await fetch(API + '/api/jobs/' + jobId);
    const status = await resp.json();
    if (status.status === 'succeeded' || status.status === 'failed') return status;
    setProgress(50 + Math.floor(i / 80 * 30));
  }
  throw new Error('Timed out');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loadResultImage(url) {
  resultUrl = url;
  const img = new Image();
  img.onload = () => {
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 960;
    canvas.width = w; canvas.height = h;
    canvas.style.display = 'block';
    ctx.drawImage(img, 0, 0, w, h);
    document.getElementById('resultBar').style.display = 'flex';
  };
  img.src = url;
}

function clearResult() {
  resultUrl = null;
  canvas.style.display = 'none';
  document.getElementById('resultBar').style.display = 'none';
}

function downloadResult() {
  if (!resultUrl) return;
  fetch(resultUrl).then(r => r.blob()).then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'anywear-live-' + Date.now() + '.jpg';
    a.click();
  });
}

// Init
loadGarments();
</script>
</body>
</html>"""


@router.get("/live", response_class=HTMLResponse)
def live_studio():
    """Live camera try-on studio page."""
    return HTMLResponse(LIVE_HTML)
