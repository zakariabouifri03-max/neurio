// Montaj Pro — inspector panels (declarative controls)
import { qs, qa, clamp, fmtTime, toast, uid, isMobile } from './util.js';
import { FONTS, FILTERS, TRANSITIONS, ANIMS, STICKERS, SHAPES, makeT } from './i18n.js';
import {
  getProject, updateClip, addClip, newClip, snapshot, emit, projectDuration, setKey, removeKey,
  addKeyHere, hasKeys, clipById, clipsOf, freeSlot, removeClip, ASPECTS, RES_PRESETS,
} from './state.js';
import { clipVolumeAt, filterById } from './effects.js';
import { beatsForProject } from './audio.js';

const t = makeT();

// ---------- control factory ----------
export function ctl(container, opts) {
  const { label, value, min, max, step = 0.01, unit = '', onInput, onCommit, keyframe, type = 'slider', options, id } = opts;
  const row = document.createElement('div');
  row.className = 'ctl ctl-' + type;
  let input;
  const lab = document.createElement('div');
  lab.className = 'ctl-label';
  lab.innerHTML = `<span>${label}</span>`;
  if (type === 'slider') {
    const val = document.createElement('span');
    val.className = 'ctl-val';
    val.textContent = fmtVal(value, unit);
    lab.appendChild(val);
    input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = fmtVal(v, unit);
      onInput && onInput(v);
    });
    input.addEventListener('change', () => { onCommit && onCommit(parseFloat(input.value)); });
  } else if (type === 'select') {
    input = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      input.appendChild(opt);
    }
    input.addEventListener('change', () => { onInput && onInput(input.value); onCommit && onCommit(input.value); });
  } else if (type === 'color') {
    input = document.createElement('input');
    input.type = 'color'; input.value = value || '#ffffff';
    input.addEventListener('input', () => onInput && onInput(input.value));
    input.addEventListener('change', () => onCommit && onCommit(input.value));
  } else if (type === 'text') {
    input = document.createElement('input');
    input.type = 'text'; input.value = value || '';
    input.addEventListener('input', () => onInput && onInput(input.value));
    input.addEventListener('change', () => onCommit && onCommit(input.value));
  } else if (type === 'textarea') {
    input = document.createElement('textarea');
    input.value = value || ''; input.rows = 3;
    input.addEventListener('input', () => onInput && onInput(input.value));
    input.addEventListener('change', () => onCommit && onCommit(input.value));
  } else if (type === 'toggle') {
    input = document.createElement('button');
    input.className = 'tg' + (value ? ' on' : '');
    input.innerHTML = '<i></i>';
    input.addEventListener('click', () => {
      const v = !input.classList.contains('on');
      input.classList.toggle('on', v);
      onInput && onInput(v); onCommit && onCommit(v);
    });
  }
  row.appendChild(lab);
  if (input) row.appendChild(input);
  if (keyframe) {
    const kb = document.createElement('button');
    kb.className = 'kf-btn' + (opts.keyed ? ' keyed' : '');
    kb.title = t('keyframe');
    kb.textContent = '◈';
    kb.addEventListener('click', (ev) => { ev.stopPropagation(); keyframe(); });
    row.appendChild(kb);
  }
  container.appendChild(row);
  return row;
}
function fmtVal(v, unit) {
  if (unit === 's') return (+v).toFixed(2) + 's';
  if (unit === 'deg') return Math.round(v) + '°';
  if (unit === 'x') return (+v).toFixed(2) + 'x';
  if (unit === '%') return Math.round(v) + '%';
  return Math.round(v * 100) / 100 + (unit ? ' ' + unit : '');
}
export function section(container, title, { open = true, right } = {}) {
  const sec = document.createElement('div');
  sec.className = 'sec' + (open ? ' open' : '');
  const h = document.createElement('button');
  h.className = 'sec-head';
  h.innerHTML = `<span>${title}</span><svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  h.addEventListener('click', () => sec.classList.toggle('open'));
  sec.appendChild(h);
  if (right) { right.className = 'sec-right'; h.appendChild(right); }
  const body = document.createElement('div');
  body.className = 'sec-body';
  sec.appendChild(body);
  container.appendChild(sec);
  return body;
}
export function btnRow(container, buttons) {
  const wrap = document.createElement('div');
  wrap.className = 'btn-row';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn' + (b.kind ? ' ' + b.kind : '') + (b.active ? ' active' : '');
    el.innerHTML = (b.icon || '') + `<span>${b.label}</span>`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); b.onClick && b.onClick(); });
    wrap.appendChild(el);
  }
  container.appendChild(wrap);
  return wrap;
}
export function grid(container, items, { cols = 4, onPick, isActive } = {}) {
  const g = document.createElement('div');
  g.className = 'grid';
  g.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  for (const it of items) {
    const el = document.createElement('button');
    el.className = 'grid-item' + (isActive && isActive(it) ? ' active' : '');
    el.innerHTML = it.html || `<span>${it.label}</span>`;
    el.addEventListener('click', () => onPick && onPick(it));
    g.appendChild(el);
  }
  container.appendChild(g);
  return g;
}

// ---------- panels ----------
export function renderInspector(app) {
  const root = app.inspectorEl;
  if (!root) return;
  if (!getProject()) { root.innerHTML = ''; return; }
  const scrollTop = root.scrollTop;
  root.innerHTML = '';
  const p = getProject();
  const clip = app.selected.length ? clipById(app.selected[0]) : null;
  const tab = app.tab;
  const T = t;

  // quick tools row (always visible) when a clip is selected
  if (clip) {
    const tools = document.createElement('div');
    tools.className = 'quick-row';
    const mk = (label, icon, fn, kind) => {
      const b = document.createElement('button');
      b.className = 'qbtn' + (kind ? ' ' + kind : '');
      b.innerHTML = `${icon}<span>${label}</span>`;
      b.addEventListener('click', fn);
      tools.appendChild(b);
    };
    mk(T('split'), '✂', () => app.splitAtPlayhead());
    mk(T('duplicate'), '⧉', () => app.duplicateSelection());
    mk(T('copy'), '⎘', () => app.copySelection());
    mk(T('delete'), '🗑', () => app.deleteSelection());
    root.appendChild(tools);
  }

  switch (tab) {
    case 'media': panelMedia(root, app); break;
    case 'audio': panelAudio(root, app, clip); break;
    case 'text': panelText(root, app, clip); break;
    case 'stickers': panelStickers(root, app); break;
    case 'effects': panelEffects(root, app, clip); break;
    case 'motion': panelMotion(root, app, clip); break;
    case 'speed': panelSpeed(root, app, clip); break;
    case 'captions': panelCaptions(root, app); break;
    case 'export': panelExport(root, app); break;
    default: panelProject(root, app); break;
  }
  root.scrollTop = scrollTop;
}

function panelMedia(root, app) {
  const p = getProject();
  const b = section(root, t('media'));
  btnRow(b, [{
    label: t('import'), kind: 'primary', icon: '＋', onClick: () => app.pickFiles(),
  }, { label: t('addTrack'), onClick: () => { app.addTrack('overlay'); } }]);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = t('dropFiles') + ' · ' + t('importHint');
  b.appendChild(hint);
  if (!p.media.length) return;
  const g = document.createElement('div');
  g.className = 'media-grid';
  for (const m of p.media) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.draggable = true;
    card.dataset.mediaId = m.id;
    card.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ mediaId: m.id })));
    card.innerHTML = `
      <div class="mc-thumb" style="background-image:url('${m.thumb || ''}')">
        <span class="mc-kind">${m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎵' : '🖼'}</span>
        ${m.duration ? `<span class="mc-dur">${fmtTime(m.duration)}</span>` : ''}
      </div>
      <div class="mc-name">${escapeHtml(m.name)}</div>`;
    card.addEventListener('click', () => app.addMediaToTimeline(m.id));
    const del = document.createElement('button');
    del.className = 'mc-del';
    del.textContent = '✕';
    del.addEventListener('click', (ev) => { ev.stopPropagation(); app.removeMedia(m.id); });
    card.appendChild(del);
    g.appendChild(card);
  }
  b.appendChild(g);
}

function panelAudio(root, app, clip) {
  const p = getProject();
  const add = section(root, t('audio'));
  btnRow(add, [
    { label: t('import'), icon: '＋', onClick: () => app.pickFiles('audio/*') },
    { label: t('record'), icon: '🎙', kind: app.recording ? 'danger' : '', onClick: () => app.toggleVoiceover() },
  ]);
  const audios = p.media.filter(m => m.kind === 'audio' || (m.kind === 'video' && m.hasAudio));
  if (audios.length) {
    const g = document.createElement('div');
    g.className = 'media-grid';
    for (const m of audios) {
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = `<div class="mc-thumb" style="background-image:url('${m.thumb || ''}')"><span class="mc-kind">🎵</span></div><div class="mc-name">${escapeHtml(m.name)}</div>`;
      card.addEventListener('click', () => app.addMediaToTimeline(m.id, null, null, 'audio'));
      g.appendChild(card);
    }
    add.appendChild(g);
  }
  btnRow(add, [{ label: t('beatsAutoCut'), icon: '🥁', onClick: () => app.autoCutOnBeats() }]);

  if (!clip) return;
  const s = section(root, t('volume'));
  ctl(s, {
    label: t('volume'), type: 'slider', min: 0, max: 2, step: 0.01, value: clip.volume ?? 1, unit: '%',
    onInput: (v) => { updateClip(clip.id, { volume: v }, { silent: true }); app.schedulePreviewDraw(); },
    onCommit: () => app.commitHistory(),
    keyframe: () => toggleKey(app, clip, 'volume'),
    keyed: hasKeys(clip, 'volume'),
  });
  ctl(s, {
    label: t('fadeIn'), type: 'slider', min: 0, max: Math.max(0.1, clip.duration / 2), step: 0.05, value: clip.fadeIn || 0, unit: 's',
    onInput: (v) => { clip.fadeIn = v; },
    onCommit: () => app.commitHistory(),
  });
  ctl(s, {
    label: t('fadeOut'), type: 'slider', min: 0, max: Math.max(0.1, clip.duration / 2), step: 0.05, value: clip.fadeOut || 0, unit: 's',
    onInput: (v) => { clip.fadeOut = v; },
    onCommit: () => app.commitHistory(),
  });
  ctl(s, {
    label: t('mute'), type: 'toggle', value: !!clip.muted,
    onCommit: (v) => { updateClip(clip.id, { muted: v }); snapshot('mute'); },
  });
  btnRow(s, [
    { label: t('reverse'), icon: '⇄', active: !!clip.reverse, onClick: () => { updateClip(clip.id, { reverse: !clip.reverse }); snapshot('reverse'); app.renderTimeline(); } },
    { label: 'استخراج الصوت', icon: '⤓', onClick: () => app.extractAudio(clip) },
  ]);
}

function panelText(root, app, clip) {
  const add = section(root, t('text'));
  btnRow(add, [{ label: '+ ' + t('text'), kind: 'primary', onClick: () => app.addTextClip() }]);
  const isText = clip && clip.type === 'text';
  if (!isText) {
    grid(add, [
      { html: '<div class="preset-big">عنوان</div>', label: 'title' },
      { html: '<div class="preset-sub">نص صغير</div>', label: 'sub' },
      { html: '<div class="preset-stroke">STROKE</div>', label: 'stroke' },
      { html: '<div class="preset-bg">مربع</div>', label: 'box' },
    ], { cols: 2, onPick: (it) => app.addTextClip(it.label) });
    return;
  }
  const tx = clip.text || {};
  const s = section(root, t('content'));
  ctl(s, {
    label: t('content'), type: 'textarea', value: tx.content || '',
    onInput: (v) => { tx.content = v; app.schedulePreviewDraw(); },
    onCommit: () => { app.commitHistory(); app.renderTimeline(); },
  });
  ctl(s, {
    label: t('font'), type: 'select', value: tx.font || 'Cairo',
    options: FONTS.map(f => ({ value: f.id, label: f.label })),
    onInput: (v) => { tx.font = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory(),
  });
  ctl(s, { label: t('size'), type: 'slider', min: 12, max: 400, step: 1, value: tx.size || 72, onInput: (v) => { tx.size = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s, { label: t('color'), type: 'color', value: tx.color || '#ffffff', onInput: (v) => { tx.color = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s, { label: t('stroke'), type: 'color', value: tx.stroke || '#000000', onInput: (v) => { tx.stroke = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s, { label: t('stroke') + ' W', type: 'slider', min: 0, max: 40, step: 0.5, value: tx.strokeWidth || 0, onInput: (v) => { tx.strokeWidth = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s, { label: t('shadow'), type: 'toggle', value: tx.shadow !== false, onCommit: (v) => { tx.shadow = v; app.commitHistory(); app.schedulePreviewDraw(); } });
  ctl(s, { label: t('background'), type: 'color', value: hexA(tx.bg || 'transparent'), onInput: (v) => { tx.bg = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s, { label: t('intensity'), type: 'slider', min: 0, max: 1, step: 0.02, value: tx.bgAlpha ?? 0.85, onInput: (v) => { tx.bgAlpha = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s, { label: 'RTL', type: 'toggle', value: tx.rtl !== false, onCommit: (v) => { tx.rtl = v; app.schedulePreviewDraw(); app.commitHistory(); } });
  const anim = section(root, t('animations'));
  ctl(anim, {
    label: t('animIn'), type: 'select', value: (clip.animIn && clip.animIn.type) || 'none',
    options: ANIMS.map(a => ({ value: a, label: animLabel(a) })),
    onCommit: (v) => { clip.animIn = { type: v, dur: (clip.animIn && clip.animIn.dur) || 0.5 }; snapshot('anim'); app.schedulePreviewDraw(); },
  });
  ctl(anim, {
    label: t('animOut'), type: 'select', value: (clip.animOut && clip.animOut.type) || 'none',
    options: ANIMS.map(a => ({ value: a, label: animLabel(a) })),
    onCommit: (v) => { clip.animOut = { type: v, dur: (clip.animOut && clip.animOut.dur) || 0.5 }; snapshot('anim'); app.schedulePreviewDraw(); },
  });
}

function panelStickers(root, app) {
  const add = section(root, t('stickers'));
  grid(add, STICKERS.map(e => ({ html: `<span class="emoji">${e}</span>`, value: e, label: e })), {
    cols: 6,
    onPick: (it) => app.addSticker(it.value),
  });
  const sh = section(root, t('stickers') + ' — أشكال');
  grid(sh, SHAPES.map(s => ({ html: `<span class="shape-ico shape-${s}"></span>`, value: s, label: s })), {
    cols: 4, onPick: (it) => app.addShape(it.value),
  });
}

function panelEffects(root, app, clip) {
  const p = getProject();
  const s1 = section(root, t('filters'));
  grid(s1, FILTERS.map(f => ({
    value: f.id,
    html: `<div class="fx-thumb" style="filter:${f.css || 'none'}"></div><span>${f.label[t.lang()] || f.label.en}</span>`,
  })), {
    cols: 3,
    isActive: (it) => clip && clip.filter === it.value,
    onPick: (it) => { if (!clip) return toast(t('selectClip')); updateClip(clip.id, { filter: it.value }); snapshot('filter'); renderInspector(app); },
  });
  if (clip) {
    ctl(s1, {
      label: t('intensity'), type: 'slider', min: 0, max: 100, step: 1, value: clip.filterStrength ?? 100, unit: '%',
      onInput: (v) => { updateClip(clip.id, { filterStrength: v }, { silent: true }); app.schedulePreviewDraw(); },
      onCommit: () => app.commitHistory(),
    });
  }
  if (!clip) return;
  const a = clip.adjust;
  const s2 = section(root, t('adjust'));
  const mk = (key, label, min, max) => ctl(s2, {
    label, type: 'slider', min, max, step: 0.01, value: a[key] || 0,
    onInput: (v) => { a[key] = v; app.schedulePreviewDraw(); },
    onCommit: () => app.commitHistory(),
  });
  mk('brightness', t('brightness'), -0.6, 0.6);
  mk('contrast', t('contrast'), -0.6, 0.6);
  mk('saturation', t('saturation'), -1, 1.5);
  mk('temperature', t('temperature'), -1, 1);
  mk('tint', t('tint'), -1, 1);
  mk('hue', t('hue'), -1, 1);
  ctl(s2, { label: t('blur'), type: 'slider', min: 0, max: 30, step: 0.5, value: a.blur || 0, onInput: (v) => { a.blur = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s2, { label: t('sharpen'), type: 'slider', min: 0, max: 1, step: 0.02, value: a.sharpen || 0, onInput: (v) => { a.sharpen = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s2, { label: t('vignette'), type: 'slider', min: 0, max: 1, step: 0.02, value: a.vignette || 0, onInput: (v) => { a.vignette = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(s2, { label: 'Grain', type: 'slider', min: 0, max: 1, step: 0.02, value: a.grain || 0, onInput: (v) => { a.grain = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  btnRow(s2, [{ label: t('reset'), onClick: () => { clip.adjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, blur: 0, sharpen: 0, vignette: 0, hue: 0, grain: 0 }; clip.filter = 'none'; snapshot('reset-adjust'); app.schedulePreviewDraw(); renderInspector(app); } }]);

  const ch = section(root, t('chromaKey'), { open: false });
  ctl(ch, { label: t('chromaKey'), type: 'toggle', value: !!clip.chroma.enabled, onCommit: (v) => { clip.chroma.enabled = v; snapshot('chroma'); app.schedulePreviewDraw(); } });
  ctl(ch, { label: t('color'), type: 'color', value: clip.chroma.color || '#00ff00', onInput: (v) => { clip.chroma.color = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(ch, { label: t('tolerance'), type: 'slider', min: 0.02, max: 1, step: 0.01, value: clip.chroma.tol ?? 0.28, onInput: (v) => { clip.chroma.tol = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(ch, { label: t('feather'), type: 'slider', min: 0, max: 1, step: 0.01, value: clip.chroma.feather ?? 0.12, onInput: (v) => { clip.chroma.feather = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  ctl(ch, { label: t('spill'), type: 'slider', min: 0, max: 1, step: 0.02, value: clip.chroma.spill ?? 0.4, onInput: (v) => { clip.chroma.spill = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  const cr = section(root, t('crop'), { open: false });
  for (const k of ['l', 't', 'r', 'b']) {
    ctl(cr, {
      label: k.toUpperCase(), type: 'slider', min: 0, max: 0.45, step: 0.01, value: clip.transform.crop[k] || 0,
      onInput: (v) => { clip.transform.crop[k] = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory(),
    });
  }
}

function panelMotion(root, app, clip) {
  if (!clip) { section(root, t('motion')).appendChild(hintEl(t('selectClip'))); return; }
  const tf = clip.transform;
  const s = section(root, t('position'));
  const mkKf = (key, label, min, max, val, step = 1, unit = '') => ctl(s, {
    label, type: 'slider', min, max, step, value: val, unit,
    onInput: (v) => { tf[key] = v; app.schedulePreviewDraw(); },
    onCommit: () => app.commitHistory(),
    keyframe: () => toggleKey(app, clip, key),
    keyed: hasKeys(clip, key),
  });
  const W = getProject().settings.width, H = getProject().settings.height;
  mkKf('x', 'X', -W, W, tf.x || 0);
  mkKf('y', 'Y', -H, H, tf.y || 0);
  mkKf('scale', t('scale'), 0.05, 4, tf.scale ?? 1, 0.01, 'x');
  mkKf('rotate', t('rotate'), -Math.PI, Math.PI, tf.rotate || 0, 0.01);
  mkKf('opacity', t('opacity'), 0, 1, tf.opacity ?? 1, 0.01);
  btnRow(s, [
    { label: t('flipH'), active: tf.flipH, onClick: () => { tf.flipH = !tf.flipH; snapshot('flip'); app.schedulePreviewDraw(); } },
    { label: t('flipV'), active: tf.flipV, onClick: () => { tf.flipV = !tf.flipV; snapshot('flip'); app.schedulePreviewDraw(); } },
    { label: 'Fill/Fit', onClick: () => { clip.fit = clip.fit === 'fill' ? 'contain' : 'fill'; snapshot('fit'); app.schedulePreviewDraw(); } },
  ]);
  btnRow(s, [
    { label: '↺ 90°', onClick: () => { tf.rotate = (tf.rotate || 0) - Math.PI / 2; snapshot('rot'); app.schedulePreviewDraw(); } },
    { label: '↻ 90°', onClick: () => { tf.rotate = (tf.rotate || 0) + Math.PI / 2; snapshot('rot'); app.schedulePreviewDraw(); } },
    { label: t('reset'), onClick: () => { clip.transform = { x: 0, y: 0, scale: 1, rotate: 0, flipH: false, flipV: false, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 }, radius: 0 }; snapshot('reset-tf'); app.schedulePreviewDraw(); renderInspector(app); } },
  ]);
  const kf = section(root, t('keyframes'));
  const keys = Object.entries(clip.keyframes || {}).filter(([, v]) => v && v.length);
  if (!keys.length) kf.appendChild(hintEl(t('keyframeNote')));
  else {
    for (const [prop, arr] of keys) {
      const row = document.createElement('div');
      row.className = 'kf-row';
      row.innerHTML = `<span>${prop}</span>`;
      const cnt = document.createElement('span');
      cnt.className = 'dim';
      cnt.textContent = arr.length + ' ◈';
      row.appendChild(cnt);
      const del = document.createElement('button');
      del.className = 'mini';
      del.textContent = '✕';
      del.addEventListener('click', () => { delete clip.keyframes[prop]; snapshot('kf-del'); renderInspector(app); app.schedulePreviewDraw(); });
      row.appendChild(del);
      kf.appendChild(row);
    }
  }
  const an = section(root, t('animations'));
  ctl(an, {
    label: t('animIn'), type: 'select', value: (clip.animIn && clip.animIn.type) || 'none',
    options: ANIMS.map(a => ({ value: a, label: animLabel(a) })),
    onCommit: (v) => { clip.animIn = { type: v, dur: (clip.animIn && clip.animIn.dur) || 0.5 }; snapshot('anim'); app.schedulePreviewDraw(); },
  });
  ctl(an, {
    label: t('duration'), type: 'slider', min: 0.1, max: 3, step: 0.05, value: (clip.animIn && clip.animIn.dur) || 0.5, unit: 's',
    onInput: (v) => { clip.animIn = clip.animIn || { type: 'fade' }; clip.animIn.dur = v; app.schedulePreviewDraw(); },
    onCommit: () => app.commitHistory(),
  });
  ctl(an, {
    label: t('animOut'), type: 'select', value: (clip.animOut && clip.animOut.type) || 'none',
    options: ANIMS.map(a => ({ value: a, label: animLabel(a) })),
    onCommit: (v) => { clip.animOut = { type: v, dur: (clip.animOut && clip.animOut.dur) || 0.5 }; snapshot('anim'); app.schedulePreviewDraw(); },
  });

  const tr = section(root, t('transitions'));
  grid(tr, TRANSITIONS.map(x => ({ value: x, html: `<span class="tr-ico tr-${x}"></span><span>${trLabel(x)}</span>` })), {
    cols: 4,
    isActive: (it) => clip.transition && clip.transition.type === it.value,
    onPick: (it) => { clip.transition = { type: it.value, duration: (clip.transition && clip.transition.duration) || 0.5 }; snapshot('transition'); app.schedulePreviewDraw(); renderInspector(app); },
  });
  ctl(tr, {
    label: t('duration'), type: 'slider', min: 0.1, max: 3, step: 0.05, value: (clip.transition && clip.transition.duration) || 0.5, unit: 's',
    onInput: (v) => { clip.transition = clip.transition || { type: 'fade' }; clip.transition.duration = v; app.schedulePreviewDraw(); },
    onCommit: () => app.commitHistory(),
  });
}

function panelSpeed(root, app, clip) {
  if (!clip) { section(root, t('speed')).appendChild(hintEl(t('selectClip'))); return; }
  const s = section(root, t('speed'));
  ctl(s, {
    label: t('speed'), type: 'slider', min: 0.1, max: 6, step: 0.05, value: clip.speed || 1, unit: 'x',
    onInput: (v) => { app.setSpeed(clip, v, true); },
    onCommit: () => app.commitHistory(),
  });
  btnRow(s, [0.25, 0.5, 1, 1.5, 2, 4].map(v => ({
    label: v + 'x', active: Math.abs((clip.speed || 1) - v) < 0.01,
    onClick: () => { app.setSpeed(clip, v); app.commitHistory(); renderInspector(app); },
  })));
  const info = document.createElement('div');
  info.className = 'hint';
  info.textContent = `${t('duration')}: ${clip.duration.toFixed(2)}s → ${(clip.trimOut - clip.trimIn) / (clip.speed || 1)}`;
  s.appendChild(info);
  const s2 = section(root, 'تجميد / عكس');
  btnRow(s2, [
    { label: t('reverse'), icon: '⇄', active: !!clip.reverse, onClick: () => { clip.reverse = !clip.reverse; snapshot('reverse'); app.schedulePreviewDraw(); app.renderTimeline(); } },
    { label: 'تجميد الإطار', icon: '❄', onClick: () => app.freezeFrame(clip) },
  ]);
}

function panelCaptions(root, app) {
  const s = section(root, t('captions'));
  btnRow(s, [
    { label: t('autoCaptions'), icon: '🎧', onClick: () => app.startAutoCaptions(), kind: app.listening ? 'danger' : '' },
    { label: t('addCaption'), icon: '＋', onClick: () => app.addCaptionAtPlayhead() },
  ]);
  const hint = hintEl('الترجمة التلقائية تسجّل من المايك وتحدد الأوقات تلقائياً — شغّل الفيديو بصوت عالي وسجّل.');
  s.appendChild(hint);
  if (app.captions && app.captions.length) {
    for (const c of app.captions) {
      const row = document.createElement('div');
      row.className = 'cap-row';
      const inp = document.createElement('input');
      inp.value = c.text;
      inp.addEventListener('change', () => { c.text = inp.value; app.syncCaptions(); });
      const time = document.createElement('span');
      time.className = 'dim';
      time.textContent = fmtTime(c.start) + ' → ' + fmtTime(c.end);
      row.appendChild(time); row.appendChild(inp);
      const del = document.createElement('button');
      del.className = 'mini'; del.textContent = '✕';
      del.addEventListener('click', () => { app.captions = app.captions.filter(x => x !== c); app.syncCaptions(); renderInspector(app); });
      row.appendChild(del);
      s.appendChild(row);
    }
  }
  const s2 = section(root, 'SRT');
  btnRow(s2, [
    { label: t('importSrt'), onClick: () => app.importSrt() },
    { label: t('exportSrt'), onClick: () => app.exportSrt() },
  ]);
}

function panelExport(root, app) {
  const es = app.exportSettings;
  const p = getProject();
  const s = section(root, t('exportVideo'));
  btnRow(s, [{
    label: t('exportNow'), kind: 'primary big', icon: '⬆',
    onClick: () => app.openExportModal(true),
  }]);
  const info = document.createElement('div');
  info.className = 'hint';
  info.textContent = `${p.settings.width}×${p.settings.height} · ${p.settings.fps}fps · ${fmtTime(projectDuration(p))}`;
  s.appendChild(info);
  const s2 = section(root, t('settings'));
  ctl(s2, {
    label: t('resolution'), type: 'select', value: es.height,
    options: RES_PRESETS.map(r => {
      const ar = p.settings.width / p.settings.height;
      const w = Math.round(r * ar / 2) * 2;
      return { value: r, label: `${w}×${r}` };
    }),
    onInput: (v) => { es.height = +v; },
  });
  ctl(s2, {
    label: t('fps'), type: 'select', value: es.fps,
    options: [24, 25, 30, 50, 60].map(f => ({ value: f, label: f + ' fps' })),
    onInput: (v) => { es.fps = +v; },
  });
  ctl(s2, {
    label: t('format'), type: 'select', value: es.format,
    options: [{ value: 'mp4', label: 'MP4 (H.264/AAC)' }, { value: 'webm', label: 'WebM (VP9/Opus)' }],
    onInput: (v) => { es.format = v; },
  });
  ctl(s2, {
    label: t('renderMode'), type: 'select', value: es.engine,
    options: [{ value: 'auto', label: 'تلقائي' }, { value: 'fast', label: t('fast') }, { value: 'live', label: t('live') }],
    onInput: (v) => { es.engine = v; },
  });
  ctl(s2, {
    label: t('bitrate') + ' (Mbps)', type: 'slider', min: 1, max: 60, step: 1, value: Math.round((es.bitrate || 0) / 1e6) || 12,
    onInput: (v) => { es.bitrate = v * 1e6; },
  });
}

function panelProject(root, app) {
  const p = getProject();
  const s = section(root, t('project'));
  ctl(s, {
    label: t('name'), type: 'text', value: p.name,
    onInput: (v) => { p.name = v; },
    onCommit: () => app.commitHistory(),
  });
  const res = section(s, 'القياس والاتجاه');
  ctl(res, {
    label: t('aspect'), type: 'select', value: p.settings.aspect || '9:16',
    options: Object.entries(ASPECTS).map(([k, v]) => ({ value: k, label: k + ` (${v[0]}×${v[1]})` })),
    onInput: (v) => {
      const [w, h] = ASPECTS[v];
      const scale = p.settings.width / w;
      p.settings.width = w; p.settings.height = h; p.settings.aspect = v;
      app.fitPreview(); app.schedulePreviewDraw(); app.renderTimeline();
    },
    onCommit: () => app.commitHistory(),
  });
  ctl(res, {
    label: t('resolution'), type: 'select', value: p.settings.height,
    options: RES_PRESETS.map(r => {
      const ar = p.settings.width / p.settings.height;
      return { value: r, label: `${Math.round(r * ar / 2) * 2}×${r}` };
    }),
    onInput: (v) => {
      const ar = p.settings.width / p.settings.height;
      p.settings.height = +v; p.settings.width = Math.round(+v * ar / 2) * 2;
      app.fitPreview(); app.schedulePreviewDraw();
    },
    onCommit: () => app.commitHistory(),
  });
  ctl(res, {
    label: t('fps'), type: 'select', value: p.settings.fps,
    options: [24, 25, 30, 50, 60].map(f => ({ value: f, label: f + ' fps' })),
    onInput: (v) => { p.settings.fps = +v; app.renderTimeline(); },
  });
  ctl(res, { label: 'الخلفية', type: 'color', value: p.settings.bg || '#000000', onInput: (v) => { p.settings.bg = v; app.schedulePreviewDraw(); }, onCommit: () => app.commitHistory() });
  const view = section(root, 'المعاينة والخط الزمني');
  ctl(view, { label: t('previewQuality'), type: 'select', value: app.previewQuality, options: [{ value: 1, label: t('high') }, { value: 0.6, label: t('medium') }, { value: 0.35, label: t('low') }], onInput: (v) => { app.previewQuality = +v; } });
  ctl(view, { label: t('snapping'), type: 'toggle', value: app.snapping, onCommit: (v) => { app.snapping = v; } });
  ctl(view, { label: t('grid'), type: 'toggle', value: app.grid, onCommit: (v) => { app.grid = v; app.preview.drawGuides(); } });
  ctl(view, { label: t('safeArea'), type: 'toggle', value: app.safeArea, onCommit: (v) => { app.safeArea = v; app.preview.drawGuides(); } });
  const pr = section(root, t('projects'));
  btnRow(pr, [
    { label: t('save'), icon: '💾', onClick: () => app.saveProject() },
    { label: t('newProject'), icon: '＋', onClick: () => app.newProjectFlow() },
    { label: t('open'), icon: '📂', onClick: () => app.openProjectsModal() },
  ]);
  const lg = section(root, t('lang'));
  btnRow(lg, [
    { label: 'العربية', active: t.lang() === 'ar', onClick: () => { t.set('ar'); app.rerender(); } },
    { label: 'English', active: t.lang() === 'en', onClick: () => { t.set('en'); app.rerender(); } },
  ]);
  const about = section(root, 'حول', { open: false });
  about.appendChild(hintEl('Montaj Pro — محرر فيديو في المتصفح. كل المعالجة محلية 100% بلا إنترنت وبلا رفع ملفات. WebCodecs + Canvas + WebAudio.'));
}

// ---------- helpers ----------
function toggleKey(app, clip, prop) {
  const localT = clamp(app.time - clip.start, 0, clip.duration);
  const arr = clip.keyframes && clip.keyframes[prop];
  const exists = arr && arr.some(k => Math.abs(k.t - localT / clip.duration) < 0.01);
  if (exists) removeKey(clip, prop, localT);
  else addKeyHere(clip, prop, localT);
  snapshot('keyframe');
  renderInspector(app);
  app.schedulePreviewDraw();
}
function hintEl(text) {
  const d = document.createElement('div');
  d.className = 'hint';
  d.textContent = text;
  return d;
}
function animLabel(a) {
  const map = {
    none: t('none'), fade: 'ظهور', slideUp: 'صعود', slideDown: 'نزول', slideLeft: 'يسار', slideRight: 'يمين',
    zoomIn: 'تكبير دخول', zoomOut: 'تكبير خروج', pop: 'فرقعة', rotateIn: 'دوران', blurIn: 'ضباب',
    bounce: 'قفز', wipeUp: 'كشف',
  };
  return map[a] || a;
}
function trLabel(x) {
  const map = {
    none: t('none'), fade: 'تلاشي', dissolve: 'مزج', slideLeft: 'انزلاق ←', slideRight: 'انزلاق →', slideUp: 'انزلاق ↑', slideDown: 'انزلاق ↓',
    zoomIn: 'زووم دخول', zoomOut: 'زووم خروج', wipeLeft: 'مسح ←', wipeRight: 'مسح →', wipeUp: 'مسح ↑', wipeDown: 'مسح ↓',
    circle: 'دائرة', blur: 'ضباب', spin: 'دوران', glitch: 'غليتش', whip: 'سوط',
  };
  return map[x] || x;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hexA(c) { return /^#([0-9a-f]{6})$/i.test(c) ? c : '#000000'; }
export { escapeHtml, trLabel, animLabel };
