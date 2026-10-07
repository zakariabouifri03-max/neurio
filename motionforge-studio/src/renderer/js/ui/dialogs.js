// Dialogs: New project, Settings (General / AI providers / Shortcuts / Performance), About, Shortcut list.
import { h, clamp } from '../core/util.js';
import { S, bus } from '../core/state.js';
import { TEMPLATES } from '../core/templates.js';
import { startProject, confirmDiscard } from '../core/io.js';
import { COMMANDS, shortcutOf, defaultShortcutOf, setUserShortcuts, userShortcuts, comboOf, prettyKey } from '../core/commands.js';
import { aiSettings, getProvider, providerTypes, DEFAULT_AI } from '../ai/providers.js';
import { modal, toast, button, selectField, numField, checkField } from './common.js';
import { VP, QUALITY } from './viewport.js';
import { icon } from './icons.js';

const mf = () => window.mf;
// ───────── settings persistence ─────────
let saveTimer = null;
export async function loadSettings() {
  try { const s = await mf().settings.get(); S.settings = s && typeof s === 'object' ? s : {}; } catch { S.settings = {}; }
  setUserShortcuts(S.settings.shortcuts || {});
  if (S.settings.mode) S.ui.mode = S.settings.mode;
  if (S.settings.quality) S.ui.quality = S.settings.quality;
  if (S.settings.autoProxy != null) VP.state.autoProxy = !!S.settings.autoProxy;
  if (S.settings.tlZoom) S.ui.tlZoom = S.settings.tlZoom;
  aiSettings();
}
export function saveSettings() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { mf().settings.set(JSON.parse(JSON.stringify(S.settings))); } catch (e) { console.warn('settings save', e); } }, 300); }
export function addRecent(p) { const r = (S.settings.recent || []).filter((x) => x !== p); r.unshift(p); S.settings.recent = r.slice(0, 10); saveSettings(); }

// ───────── New project ─────────
const SIZES = [['1280x720', '1280 × 720 (HD)'], ['1920x1080', '1920 × 1080 (Full HD)'], ['2560x1440', '2560 × 1440 (2K)'], ['3840x2160', '3840 × 2160 (4K)'], ['1080x1920', '1080 × 1920 (Vertical 9:16)'], ['1080x1080', '1080 × 1080 (Square)'], ['854x480', '854 × 480 (SD)']];
export async function newProjectDialog() {
  if (!(await confirmDiscard())) return false;
  let t = TEMPLATES[0]; const o = { name: 'Untitled', w: t.w, h: t.h, fps: t.fps, bg: t.bg };
  const grid = h('div.tpl-grid'); const form = h('div.form');
  const sizeSel = h('select'); const nameI = h('input.txt', { value: o.name }); const fpsI = h('input.num', { type: 'number', min: 1, max: 120, value: o.fps }); const bgI = h('input', { type: 'color', value: o.bg });
  SIZES.forEach(([v, l]) => sizeSel.append(h('option', { value: v }, l))); sizeSel.append(h('option', { value: 'custom' }, 'Custom…'));
  const wI = h('input.num', { type: 'number', min: 16, max: 7680, value: o.w }), hI = h('input.num', { type: 'number', min: 16, max: 4320, value: o.h });
  const custom = h('div.row', h('label', 'Custom size'), wI, h('span', '×'), hI);
  const sync = () => { const k = `${o.w}x${o.h}`; sizeSel.value = SIZES.some((s) => s[0] === k) ? k : 'custom'; wI.value = o.w; hI.value = o.h; fpsI.value = o.fps; bgI.value = o.bg; custom.style.display = sizeSel.value === 'custom' ? '' : 'none'; };
  const drawTpl = () => { grid.innerHTML = ''; for (const x of TEMPLATES) grid.append(h('div.tpl' + (x === t ? '.sel' : ''), { on: { click: () => { t = x; o.w = x.w; o.h = x.h; o.fps = x.fps; o.bg = x.bg; drawTpl(); sync(); }, dblclick: () => ok() } }, h('div.pv', { style: { background: x.bg, color: '#0006' } }, `${x.w}×${x.h}`), h('b', x.name), h('small', x.desc))); };
  sizeSel.addEventListener('change', () => { if (sizeSel.value !== 'custom') { const [w, hh] = sizeSel.value.split('x').map(Number); o.w = w; o.h = hh; } sync(); });
  wI.addEventListener('change', () => { o.w = clamp(+wI.value || 1280, 16, 7680); sync(); }); hI.addEventListener('change', () => { o.h = clamp(+hI.value || 720, 16, 4320); sync(); });
  fpsI.addEventListener('change', () => { o.fps = clamp(Math.round(+fpsI.value) || 24, 1, 120); sync(); }); bgI.addEventListener('input', () => { o.bg = bgI.value; });
  nameI.addEventListener('input', () => { o.name = nameI.value; });
  form.append(h('label.fld', h('span', 'Project name'), nameI), h('div.row', h('label', 'Canvas size'), sizeSel), custom, h('div.row', h('label', 'Frame rate'), fpsI, h('span.hint', 'fps (1–120)')), h('div.row', h('label', 'Background'), bgI));
  drawTpl(); sync();
  let okFn; const ok = () => okFn && okFn(true);
  const r = await modal({ title: 'New project', width: 780, body: h('div.newproj', h('div.hint', 'Choose a template — every template is a normal project you can change freely.'), grid, h('div.sep'), form), buttons: [{ label: 'Cancel', value: null }, { label: 'Create project', primary: true, onClick: (c) => { okFn = c; c(true); } }] });
  if (!r) return false;
  startProject({ template: t, name: o.name.trim() || 'Untitled', width: o.w, height: o.h, fps: o.fps, bg: o.bg }); return true;
}

// ───────── Settings ─────────
export async function settingsDialog(tab = 'general') {
  const body = h('div.settings'); const nav = h('div.snav'); const page = h('div.spage');
  const tabs = [['general', 'General'], ['ai', 'AI Providers'], ['shortcuts', 'Shortcuts'], ['perf', 'Performance']];
  const show = (t) => { tab = t; nav.innerHTML = ''; tabs.forEach(([k, l]) => nav.append(h('div.sn' + (k === t ? '.on' : ''), { on: { click: () => show(k) } }, l))); page.innerHTML = ''; ({ general, ai, shortcuts, perf })[t](page); };
  body.append(nav, page); show(tab);
  await modal({ title: 'Settings', width: 780, cls: 'settings-modal', body, buttons: [{ label: 'Close', primary: true, value: true }] });
  saveSettings(); bus.emit('settings');
}
function general(el) {
  el.append(h('h3', 'General'),
    numField('Autosave every (min)', S.settings.autosaveMinutes ?? 2, (v) => { S.settings.autosaveMinutes = Math.max(0, v); saveSettings(); }, { min: 0, max: 60, step: 1, width: '70px', tip: '0 turns autosave off. Autosaves go to a recovery folder, never over your file.' }),
    h('div.hint', 'Autosaves are stored separately from your project. After a crash, MotionForge offers to recover the latest autosave on next launch. Saving a project also keeps a .bak copy of the previous version.'),
    selectField('Interface mode', [['pro', 'Pro — all panels'], ['beginner', 'Beginner — simplified']], S.ui.mode, (v) => { import('../app.js').then((m) => m.setMode(v)); }),
    selectField('Default timeline zoom', [['8', 'Compact'], ['14', 'Normal'], ['24', 'Large']], String(S.ui.tlZoom), (v) => { S.ui.tlZoom = +v; S.settings.tlZoom = +v; saveSettings(); bus.emit('timeline-zoom'); }),
    checkField('Show tooltips', S.settings.tooltips !== false, (v) => { S.settings.tooltips = v; saveSettings(); }));
}
async function ai(el) {
  const cfg = aiSettings(); let sel = cfg.active;
  const draw = async () => {
    el.innerHTML = ''; el.append(h('h3', 'AI Providers'),
      h('div.hint', 'MotionForge works fully offline. Connect a provider to get smarter animation plans from natural language. API keys are encrypted with the operating system and are never saved in your project, settings file, or source code.'));
    const list = h('div.plist');
    for (const p of cfg.providers) list.append(h('div.pitem' + (p.id === sel ? '.sel' : ''), { on: { click: () => { sel = p.id; draw(); } } }, h('span.dot' + (cfg.active === p.id ? '.on' : '')), h('span', p.label || p.id)));
    const types = providerTypes().filter((t) => t.type !== 'offline');
    list.append(h('div.pitem.add', { on: { click: async () => { const ty = types[0]; const id = 'p' + Math.random().toString(36).slice(2, 7); cfg.providers.push({ id, type: ty.type, label: 'New provider', ...(ty.defaults || {}) }); sel = id; saveSettings(); draw(); } } }, '＋ Add provider'));
    const p = cfg.providers.find((x) => x.id === sel) || cfg.providers[0]; const form = h('div.pform');
    const meta = providerTypes().find((t) => t.type === p.type) || {};
    form.append(h('div.row', h('label', 'Active'), h('button.btn.small' + (cfg.active === p.id ? '.primary' : ''), { on: { click: () => { cfg.active = p.id; saveSettings(); bus.emit('settings'); draw(); } } }, cfg.active === p.id ? '✓ In use' : 'Use this provider')));
    if (p.type !== 'offline') {
      const field = (label, key, ph, type = 'text') => { const i = h('input.txt', { type, value: p[key] ?? '', placeholder: ph || '', on: { input: () => { p[key] = type === 'number' ? parseFloat(i.value) : i.value; saveSettings(); }, keydown: (e) => e.stopPropagation() } }); return h('div.row', h('label', label), i); };
      form.append(field('Name', 'label'), selectField('Type', types.map((t) => [t.type, t.label]), p.type, (v) => { p.type = v; const d = (types.find((t) => t.type === v) || {}).defaults || {}; for (const k in d) if (!p[k]) p[k] = d[k]; saveSettings(); draw(); }),
        field('Base URL', 'baseUrl', 'https://api.example.com/v1'), field('Model', 'model', 'model name'), field('Temperature', 'temperature', '0.2', 'number'));
      if (meta.needsKey !== false) {
        let has = false; try { has = await mf().secret.has(p.id); } catch {}
        const key = h('input.txt', { type: 'password', placeholder: has ? '•••••••• (stored — type to replace)' : 'Paste your API key', autocomplete: 'off', on: { keydown: (e) => e.stopPropagation() } });
        const stat = h('span.hint', has ? '🔒 A key is stored securely for this provider.' : 'No key stored.');
        form.append(h('div.row', h('label', 'API key'), key), h('div.flex', button('Save key', async () => { if (!key.value.trim()) { toast('Enter a key first.', 'info'); return; } const r = await mf().secret.set(p.id, key.value.trim()); key.value = ''; stat.textContent = r.sessionOnly ? 'Key kept in memory for this session only (OS encryption unavailable).' : '🔒 Key stored securely.'; toast('API key saved.', 'success'); }, { cls: 'small primary' }), button('Remove key', async () => { await mf().secret.set(p.id, ''); stat.textContent = 'No key stored.'; toast('API key removed.', 'info'); }, { cls: 'small' }), stat));
      }
      form.append(h('div.flex', button('Test connection', async (e) => { const b = e.currentTarget; b.disabled = true; const out = form.querySelector('.ptest'); out.textContent = 'Testing…'; out.className = 'ptest hint'; try { const r = await getProvider(p.id).test(); out.textContent = '✓ Connected — reply: ' + String(r).replace(/\s+/g, ' ').slice(0, 60); out.className = 'ptest ok'; } catch (er) { out.textContent = '✗ ' + (er.message || er); out.className = 'ptest err'; } b.disabled = false; }, { cls: 'small' }),
        button('Delete provider', () => { cfg.providers = cfg.providers.filter((x) => x.id !== p.id); if (cfg.active === p.id) cfg.active = 'offline'; sel = cfg.active; saveSettings(); draw(); }, { cls: 'small danger' })), h('div.ptest.hint'));
      form.append(h('div.hint', p.type === 'local' ? 'Local servers (Ollama, LM Studio…) need no key. Start the server and use its OpenAI-compatible URL.' : 'Works with any service that offers an OpenAI-compatible /chat/completions endpoint (OpenAI, OpenRouter, Groq, Together, Azure gateways, …).'));
    } else form.append(h('div.hint', 'The built-in planner understands everyday phrases (walk, run, wave, sit, jump, dance, talk, camera zoom/pan, rooms, chairs…) and needs no network or key.'));
    el.append(h('div.psplit', list, form));
  };
  await draw();
}
function shortcuts(el) {
  el.append(h('h3', 'Keyboard shortcuts'), h('div.hint', 'Click a shortcut, then press the new key combination. Esc cancels, Backspace clears.'));
  const filter = h('input.txt', { placeholder: 'Filter commands…', on: { input: () => draw(), keydown: (e) => e.stopPropagation() } }); const list = h('div.sclist');
  el.append(filter, h('div.flex', button('Reset all to defaults', () => { setUserShortcuts({}); S.settings.shortcuts = {}; saveSettings(); draw(); }, { cls: 'small' })), list);
  function draw() {
    list.innerHTML = ''; const q = filter.value.toLowerCase(); const cats = {};
    for (const c of COMMANDS.values()) { if (!c.label || c.hidden) continue; if (q && !(c.label + ' ' + c.cat).toLowerCase().includes(q)) continue; (cats[c.cat] = cats[c.cat] || []).push(c); }
    for (const [cat, cs] of Object.entries(cats)) {
      list.append(h('div.scat', cat));
      for (const c of cs) {
        const cur = shortcutOf(c.id); const changed = c.id in userShortcuts();
        const cell = h('button.kbd.rec', { title: 'Click to change', on: { click: () => record(c, cell) } }, cur ? prettyKey(cur) : '—');
        list.append(h('div.scrow', h('span.grow', c.label), cell, changed ? h('button.icon-btn', { tip: 'Reset to default', on: { click: () => { const m = { ...userShortcuts() }; delete m[c.id]; setUserShortcuts(m); S.settings.shortcuts = m; saveSettings(); draw(); } } }, '↺') : null));
      }
    }
  }
  function record(c, cell) {
    cell.textContent = 'Press keys…'; cell.classList.add('on');
    const fn = (e) => {
      e.preventDefault(); e.stopPropagation(); if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      document.removeEventListener('keydown', fn, true);
      if (e.key === 'Escape') { draw(); return; }
      const m = { ...userShortcuts() };
      if (e.key === 'Backspace') m[c.id] = ''; else {
        const combo = comboOf(e); const clash = [...COMMANDS.values()].find((x) => x.id !== c.id && (shortcutOf(x.id) || '').split('|').includes(combo));
        if (clash) { toast(`“${combo}” is already used by “${clash.label}”. It was reassigned.`, 'warn', 4000); m[clash.id] = ''; }
        m[c.id] = combo;
      }
      setUserShortcuts(m); S.settings.shortcuts = m; saveSettings(); draw();
    };
    document.addEventListener('keydown', fn, true);
  }
  draw();
}
function perf(el) {
  el.append(h('h3', 'Performance'),
    selectField('Preview quality', Object.keys(QUALITY).map((k) => [k, { draft: 'Draft (fastest, half resolution)', normal: 'Normal', high: 'High (1.5×)', final: 'Final (2× supersampled)' }[k]]), S.ui.quality, (v) => { S.ui.quality = v; S.settings.quality = v; saveSettings(); bus.emit('quality'); bus.emit('render'); }),
    checkField('Automatic proxy preview during playback', VP.state.autoProxy, (v) => { VP.state.autoProxy = v; S.settings.autoProxy = v; saveSettings(); }, 'Plays back at half resolution to keep the frame rate smooth in heavy scenes. Editing and export are always full quality.'),
    numField('Frame cache budget (MB)', S.settings.memoryMB ?? 900, (v) => { S.settings.memoryMB = clamp(Math.round(v), 200, 8000); saveSettings(); }, { min: 200, max: 8000, step: 100, width: '80px', tip: 'Drawings beyond this budget are compressed in memory and decoded again when needed (virtualized timeline).' }),
    checkField('Disable GPU acceleration (restart required)', !!S.settings.disableGpu, (v) => { S.settings.disableGpu = v; saveSettings(); toast('Restart MotionForge for this to take effect.', 'info'); }, 'Only enable this if you see graphics glitches. The canvas, compositing and effects use the GPU by default.'),
    h('div.hint', 'Heavy work — export rendering, FFmpeg encoding, audio mixing, lip-sync analysis, auto-inbetween — runs off the main interface thread or in chunks so the UI stays responsive.'));
}

// ───────── About ─────────
export async function aboutDialog() {
  let info = {}; try { info = await mf().app.info(); } catch {}
  await modal({ title: 'About MotionForge Studio', width: 440, body: h('div.about', h('div.alogo', { html: icon('logo', 54) }), h('h2', 'MotionForge Studio'), h('div.hint', `Version ${info.version || '1.0.0'}${info.electron ? ' · Electron ' + info.electron : ''}${info.chrome ? ' · Chromium ' + info.chrome : ''}`),
    h('p', 'Professional 2D animation: frame-by-frame drawing, rigging, keyframes, camera, audio, lip sync and AI-assisted animation — all working offline.'), h('div.hint', '© 2026 MotionForge. FFmpeg is used for video export under its own license.')), buttons: [{ label: 'Close', primary: true, value: true }] });
}
export async function shortcutsDialog() { await settingsDialog('shortcuts'); }
