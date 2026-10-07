// Compiles an animation plan into ordinary, editable keyframes (bone rotations, positions, camera, props, background).
import { S, scene, fps, allLayers, layerById } from '../core/state.js';
import { addCanvasAsset, newLayer } from '../core/model.js';
import { expandClip, bakeClip, bakeTrack, charHeight, POSES, CLIPS, ALL_ROLES, findPose } from '../core/motionlib.js';
import { layerProp, layerBase, setKey, trackIndex, evalTrack } from '../core/anim.js';
import { roleMap } from '../core/rig.js';
import { drawBackground, drawProp, BACKGROUNDS, PROPS } from '../core/scenegen.js';
import { VISEMES } from '../core/rig.js';

const sgn = (v) => (v < 0 ? -1 : 1);

function teleport(layer, name, f, v) {
  const tr = (layer.tracks[name] = layer.tracks[name] || []);
  if (!tr.length) { setKey(tr, 0, layerBase(layer, name), 'hold'); }
  const i = trackIndex(tr, f - 1);
  if (i >= 0 && tr[i].f < f) tr[i].e = 'hold';
  for (let k = tr.length - 1; k >= 0; k--) if (tr[k].f === f) tr.splice(k, 1);
  setKey(tr, f, v, 'linear');
}
function putKey(layer, name, f, v, e = 'easeInOut') {
  const tr = (layer.tracks[name] = layer.tracks[name] || []);
  if (!tr.length && f > 0) setKey(tr, 0, layerBase(layer, name), e);
  setKey(tr, f, v, e);
}
function addMouthKeys(layer, start, secs, text) {
  const b = roleMap(layer.char).mouth; if (!b) return;
  const fr = fps(); const name = 'mouth';
  const order = VISEMES; const idx = (v) => order.indexOf(v);
  let seq;
  if (text) seq = textToVisemes(text);
  else { const pat = ['A', 'rest', 'O', 'E', 'A', 'M', 'I', 'A', 'U', 'rest']; seq = pat; }
  const dur = Math.max(1, Math.round(secs * fr)); const step = Math.max(2, Math.round(fr / 6));
  const tr = (layer.tracks[name] = layer.tracks[name] || []);
  for (let i = tr.length - 1; i >= 0; i--) if (tr[i].f >= start && tr[i].f <= start + dur) tr.splice(i, 1);
  if (!tr.length) setKey(tr, 0, 0, 'hold');
  setKey(tr, start, 0, 'hold');
  let k = 0;
  for (let f = start; f < start + dur - step; f += step) setKey(tr, f, idx(seq[k++ % seq.length]), 'hold');
  setKey(tr, start + dur, 0, 'hold');
}
export function textToVisemes(text) {
  const out = [];
  const t = text.toLowerCase().replace(/[^a-z\s]/g, '');
  for (const ch of t) {
    if (ch === ' ') { out.push('rest'); continue; }
    if ('a'.includes(ch)) out.push('A'); else if ('e'.includes(ch)) out.push('E'); else if ('i'.includes(ch)) out.push('I'); else if ('o'.includes(ch)) out.push('O'); else if ('u'.includes(ch)) out.push('U');
    else if ('mbp'.includes(ch)) out.push('M'); else if ('fv'.includes(ch)) out.push('F'); else if ('l'.includes(ch)) out.push('L');
  }
  return out.length ? out.filter((v, i, a) => i === 0 || v !== a[i - 1]) : ['A', 'rest'];
}

function makeImageLayer(canvas, name, cat, z, extra) {
  const P = S.project; const sc = scene();
  const a = addCanvasAsset(canvas, name, { hidden: true, group: cat });
  const l = newLayer('image', name, cat);
  l.image = { assetId: a.id, x: 0, y: 0, w: canvas.width, h: canvas.height };
  l.pivot = { x: canvas.width / 2, y: canvas.height / 2 };
  l.base.x = canvas.width / 2; l.base.y = canvas.height / 2;
  if (extra) extra(l, a);
  sc.layers.splice(Math.max(0, Math.min(sc.layers.length, z)), 0, l);
  return l;
}

export function ensureBackground(kind) {
  const sc = scene(); const P = S.project;
  const old = allLayers(sc).find((l) => l.aiBackground);
  const c = drawBackground(kind, P.width, P.height);
  if (old) { const a = addCanvasAsset(c, 'Background ' + kind, { hidden: true, group: 'background' }); old.image.assetId = a.id; old.name = 'Background: ' + BACKGROUNDS[kind]; return old; }
  return makeImageLayer(c, 'Background: ' + BACKGROUNDS[kind], 'background', 0, (l) => { l.aiBackground = true; l.locked = false; });
}
export function addPropLayer(kind, x, y, size, opts = {}) {
  const sc = scene();
  const { canvas, anchor } = drawProp(kind, size);
  // place so that anchor lands on (x,y)
  const l = makeImageLayer(canvas, PROPS[kind] || kind, 'prop', opts.z ?? 1, (ly) => {
    ly.image.x = 0; ly.image.y = 0; ly.pivot = { x: anchor.x, y: anchor.y }; ly.base.x = x; ly.base.y = y;
    ly.propKind = kind;
  });
  return l;
}

/** Find (or create) the target character layer. */
export function ensureCharacter(createFn) {
  const sc = scene();
  let l = layerById(S.selection.layerId, sc);
  if (l && l.type === 'character') return l;
  l = allLayers(sc).find((x) => x.type === 'character');
  if (l) return l;
  if (createFn) return createFn();
  return null;
}

/**
 * Apply plan to the scene. Must be called inside H.tx(). Returns a report.
 * opts: { layer, start (frame), createCharacter() }
 */
export function compilePlan(plan, opts = {}) {
  const sc = scene(); const P = S.project; const fr = fps(); const W = P.width, H = P.height;
  const layer = opts.layer || ensureCharacter(opts.createCharacter);
  if (!layer || !layer.char) throw new Error('Select or create a character first (Character → Add Starter Character).');
  layer.tracks = layer.tracks || {};
  const report = { steps: 0, keys: 0, layers: [], warnings: [...(plan.warnings || [])] };
  const cH = charHeight(layer);
  const sc0 = Math.abs(layerBase(layer, 'scaleX')) || 1;
  const start = Math.max(0, opts.start ?? S.frame);
  let t = start;
  const state = {
    x: layerProp(layer, 'x', start), ground: layerProp(layer, 'y', start), facing: sgn(layerProp(layer, 'scaleX', start)), seated: false, chair: null,
  };
  // if layer is currently seated (rotation / y offset unknown) assume standing
  const X = { left: W * 0.14, right: W * 0.86, center: W * 0.5, 'offscreen-left': -cH * 0.4, 'offscreen-right': W + cH * 0.4 };
  const resolveX = (v, dflt) => {
    if (v == null || v === 'current') return dflt;
    if (typeof v === 'number') return v;
    if (X[v] !== undefined) return X[v];
    const n = parseFloat(v); return Number.isFinite(n) ? n : dflt;
  };
  const rest = {}; // current resting pose for roles (seated stance)
  const withRest = (exp) => { if (!state.seated) return exp; for (const k of exp.keys) { if (!k.pose) continue; for (const r of exp.roles) if (r !== '_' && !(r in k.pose) && rest[r]) k.pose[r] = rest[r]; } return exp; };
  const bake = (name, o, bo) => {
    const exp = withRest(expandClip(name, o));
    const r = bakeClip(layer, exp, t, { y0: state.ground + (state.seated ? 0.1 * cH : 0), scaleX0: state.facing * sc0, ...bo });
    const total = r.endFrame - t; t = r.endFrame; return { exp, r, total };
  };
  const stepStarts = [];
  const flipTo = (dir) => {
    if (dir === state.facing) return;
    // quick turn animation
    bake('turn', { seconds: 0.35 }, { flipTo: dir * sc0, y0: state.ground }); state.facing = dir;
  };
  const standUpIfNeeded = () => { if (state.seated) { doStand(); } };
  const doStand = () => {
    bake('stand', {}, { y0: state.ground }); state.seated = false; for (const k of Object.keys(rest)) delete rest[k];
  };

  for (const s of plan.steps) {
    stepStarts.push(t); report.steps++;
    switch (s.do) {
      case 'walk': case 'run': {
        standUpIfNeeded();
        const isRun = s.do === 'run';
        let hasFrom = s.from != null && s.from !== 'current';
        let x0 = hasFrom ? resolveX(s.from, state.x) : state.x;
        let x1 = s.to != null ? resolveX(s.to, null) : null;
        if (x1 == null) {
          const dir = s.dir === 'left' ? -1 : s.dir === 'right' ? 1 : state.facing;
          const spd0 = (isRun ? 1.9 : 0.8) * cH * (s.speed || 1);
          if (s.seconds) {
            const need = spd0 * s.seconds; const room = dir > 0 ? W * 0.92 - x0 : x0 - W * 0.08;
            if (need <= room) x1 = x0 + dir * need;
            else { if (!hasFrom) { x0 = dir > 0 ? X['offscreen-left'] : X['offscreen-right']; hasFrom = true; } x1 = dir > 0 ? X['offscreen-right'] : X['offscreen-left']; }
          } else {
            x1 = dir > 0 ? W * 0.88 : W * 0.12;
            if (Math.abs(x1 - x0) > 0.45 * W) x1 = x0 + dir * 0.4 * W;
            if (Math.abs(x1 - x0) < 0.25 * W) x1 = dir > 0 ? W * 0.12 : W * 0.88;
          }
        }
        if (Math.abs(x1 - x0) < 4) { x1 = x0 + 0.3 * W * state.facing; }
        const dir = sgn(x1 - x0);
        const spd = (isRun ? 1.9 : 0.8) * cH * (s.speed || 1);
        const dist = Math.abs(x1 - x0);
        const secs = s.seconds || Math.max(0.6, dist / spd);
        if (hasFrom) { teleport(layer, 'x', t, x0); const sx = layer.tracks.scaleX = layer.tracks.scaleX || []; if (state.facing !== dir) { teleport(layer, 'scaleX', t, dir * sc0); state.facing = dir; } state.x = x0; }
        else flipTo(dir);
        // match stride to speed to limit foot sliding
        const v = dist / secs; const stride = (isRun ? 1.15 : 0.9) * cH;
        const cycle = Math.min(isRun ? 0.9 : 1.7, Math.max(isRun ? 0.34 : 0.55, stride / Math.max(1, v)));
        const t0 = t;
        const { r } = bake(s.do, { seconds: secs, cycle }, { y0: state.ground });
        bakeTrack(layer, 'x', t0, r.endFrame, [{ f: r.endFrame, v: x1, e: 'linear' }]);
        state.x = x1;
        break;
      }
      case 'jump': {
        standUpIfNeeded();
        const n = s.count || 1;
        for (let i = 0; i < n; i++) bake('jump', { seconds: Math.max(0.5, (s.seconds || 1) / (n > 1 ? 1 : 1)) }, { y0: state.ground });
        break;
      }
      case 'wave': bake('wave', { hand: s.hand || 'R', seconds: s.seconds || 2 }, { y0: state.ground + (state.seated ? 0.1 * cH : 0) }); break;
      case 'point': bake('point', { hand: s.hand || 'R' }, { y0: state.ground + (state.seated ? 0.1 * cH : 0) }); break;
      case 'idle': {
        const secs = s.seconds || 1;
        if (!state.seated && secs >= 0.8) bake('idle', { seconds: secs }, { y0: state.ground });
        else t += Math.round(secs * fr);
        break;
      }
      case 'turn': {
        const dir = s.to === 'left' ? -1 : s.to === 'right' ? 1 : -state.facing;
        if (dir === state.facing) { t += 1; break; }
        bake('turn', { seconds: s.seconds || 0.6 }, { flipTo: dir * sc0, y0: state.ground }); state.facing = dir; break;
      }
      case 'sit': {
        if (state.seated) break;
        // chair is added later (needs final x); sit
        const wantChair = plan.props.find((p) => p.kind === 'chair' || p.kind === 'bench');
        const sitX = state.x;
        bake('sit', {}, { y0: state.ground });
        Object.assign(rest, POSES.sitting); delete rest._;
        state.seated = true;
        if (wantChair && !state.chair) {
          const seatY = state.ground + 0.1 * cH + 0.06 * cH;
          const kind = wantChair.kind;
          const size = cH * 0.62;
          const cl = addPropLayer(kind, sitX - state.facing * cH * 0.03, seatY + cH * 0.01, size * (kind === 'bench' ? 1.5 : 1), { z: allLayers(sc).indexOf(layer) });
          if (state.facing < 0) cl.base.scaleX = -1;
          // move chair directly below the character layer in z-order
          const li = sc.layers.indexOf(layer), ci = sc.layers.indexOf(cl);
          if (li >= 0 && ci > li - 1) { sc.layers.splice(ci, 1); sc.layers.splice(sc.layers.indexOf(layer), 0, cl); }
          state.chair = cl; report.layers.push(cl.name);
        }
        break;
      }
      case 'stand': doStand(); break;
      case 'dance': standUpIfNeeded(); bake('dance', { seconds: s.seconds || 4 }, { y0: state.ground }); break;
      case 'talk': {
        const t0 = t; const { exp } = bake('talk', { seconds: s.seconds || 2.5 }, { y0: state.ground + (state.seated ? 0.1 * cH : 0) });
        addMouthKeys(layer, t0, exp.seconds, s.text); break;
      }
      case 'lookAround': bake('lookAround', {}, { y0: state.ground + (state.seated ? 0.1 * cH : 0) }); break;
      case 'nod': bake('nod', {}, { y0: state.ground + (state.seated ? 0.1 * cH : 0) }); break;
      case 'shake': bake('shake', {}, { y0: state.ground + (state.seated ? 0.1 * cH : 0) }); break;
      case 'sleep': standUpIfNeeded(); bake('sleep', {}, { y0: state.ground }); break;
      case 'surprise': bake('surprise', {}, { y0: state.ground + (state.seated ? 0.1 * cH : 0) }); break;
      case 'pose': case 'custom': {
        const secs = s.seconds || 0.6;
        const keys = [{ t: 0, pose: null, e: 'easeInOut' }];
        if (s.do === 'custom') { for (const k of s.keys) keys.push({ t: k.t, pose: normalizePose(k.pose), e: k.ease || 'easeInOut' }); }
        else {
          const nm = s.pose ? null : (findPose(s.name || '') || 'standing');
          const base = s.pose ? normalizePose(s.pose) : (POSES[nm] || {});
          keys.push({ t: secs, pose: JSON.parse(JSON.stringify(base)), e: 'easeInOut' });
        }
        const roles = new Set(ALL_ROLES.filter((r) => r !== 'root' || true));
        roles.add('_');
        const total = keys[keys.length - 1].t;
        const exp = { seconds: total, keys, roles: new Set([...roles].filter((r) => keys.some((k) => k.pose && (r === '_' ? k.pose._ : true)))), clip: { loop: false } };
        // a full pose resets roles that are not mentioned
        const bk = bakeClip(layer, { ...exp, roles: exp.roles }, t, { y0: state.ground });
        t = bk.endFrame; break;
      }
      default: report.warnings.push('Unsupported step ' + s.do);
    }
  }
  const end = t;
  // props
  const extra = plan.props.filter((p) => !(state.chair && (p.kind === 'chair' || p.kind === 'bench')));
  extra.forEach((p, i) => {
    if (!['ball', 'box', 'tree', 'sun', 'lamp', 'door', 'table', 'bench', 'chair'].includes(p.kind)) return;
    const k = p.kind; const px = k === 'sun' ? W * 0.12 : k === 'tree' ? W * 0.9 : k === 'door' ? W * 0.9 : k === 'lamp' ? W * 0.08 : k === 'table' ? W * 0.72 : k === 'ball' ? W * 0.7 : W * (0.22 + i * 0.12);
    const gy = k === 'sun' ? H * 0.2 : state.ground + cH * 0.46;
    const size = k === 'sun' ? cH * 0.4 : k === 'tree' ? cH * 1.2 : k === 'door' ? cH * 1.0 : k === 'lamp' ? cH * 0.8 : cH * 0.55;
    const pl = addPropLayer(k, px, gy, size, { z: 1 + i });
    report.layers.push(pl.name);
    if (k === 'ball') { // bouncing ball prop animation
      const n = Math.max(2, Math.round((end - start) / (fr * 0.9)));
      for (let b = 0; b <= n; b++) { const f = start + Math.round(b * (end - start) / n); putKey(pl, 'y', f, b % 2 === 0 ? gy : gy - cH * 0.5, b % 2 === 0 ? 'easeIn' : 'easeOut'); }
    }
    if (k === 'sun') putKey(pl, 'rotation', start, 0, 'linear'), putKey(pl, 'rotation', Math.max(end, start + fr), 90, 'linear');
  });
  // background
  if (plan.background) { const bl = ensureBackground(plan.background); report.layers.push(bl.name); }
  // camera
  const cam = sc.camera; cam.tracks = cam.tracks || {};
  const stepFrame = (c) => { if (c.at === 'end') return Math.max(start, end - Math.round(fr * (c.seconds || 1.5))); if (typeof c.step === 'number' && stepStarts[c.step] != null) return stepStarts[c.step]; if (c.at === 'start' || c.at == null) return start; return stepStarts[Math.min(stepStarts.length - 1, Math.max(0, parseInt(c.at, 10) || 0))] ?? start; };
  for (const c of plan.camera || []) {
    const f0 = stepFrame(c); const f1 = f0 + Math.round((c.seconds || 1.5) * fr);
    const cx = (f) => layerProp(layer, 'x', f), cy = (f) => layerProp(layer, 'y', f) - cH * 0.45;
    const zoomTo = (to, focus) => {
      const z0 = layerProp(cam, 'zoom', f0); const x0 = layerProp(cam, 'x', f0), y0 = layerProp(cam, 'y', f0);
      putKeyCam(cam, 'zoom', f0, z0); putKeyCam(cam, 'zoom', f1, to);
      putKeyCam(cam, 'x', f0, x0); putKeyCam(cam, 'y', f0, y0);
      if (focus === 'head') { putKeyCam(cam, 'x', f1, cx(f1)); putKeyCam(cam, 'y', f1, layerProp(layer, 'y', f1) - cH * 0.75); }
      else if (focus !== 'none' && to > 1) { putKeyCam(cam, 'x', f1, cx(f1)); putKeyCam(cam, 'y', f1, cy(f1)); }
      else { putKeyCam(cam, 'x', f1, W / 2); putKeyCam(cam, 'y', f1, H / 2); }
    };
    if (c.do === 'zoom') zoomTo(Number(c.to) || 1.35, 'char');
    else if (c.do === 'closeup') zoomTo(1.9, 'head');
    else if (c.do === 'pan') { const dx = (c.to === 'left' ? -1 : 1) * W * 0.25; putKeyCam(cam, 'x', f0, layerProp(cam, 'x', f0)); putKeyCam(cam, 'x', f1, layerProp(cam, 'x', f0) + dx); putKeyCam(cam, 'zoom', f0, Math.max(1.1, layerProp(cam, 'zoom', f0))); putKeyCam(cam, 'zoom', f1, Math.max(1.1, layerProp(cam, 'zoom', f0))); }
    else if (c.do === 'follow') { cam.follow = { layerId: layer.id, lag: 10, ox: 0, oy: -cH * 0.3 }; if (!layerProp(cam, 'zoom', 0) || layerProp(cam, 'zoom', 0) < 1.15) putKeyCam(cam, 'zoom', 0, 1.15); }
    else if (c.do === 'shake') cam.shake = { start: f0, len: Math.round((c.seconds || 1) * fr), amp: 14, seed: Math.round(Math.random() * 100), decay: true };
  }
  if (plan.autoCamera && !(plan.camera || []).length) { // gentle push-in
    putKeyCam(cam, 'zoom', start, 1); putKeyCam(cam, 'zoom', end, 1.12);
  }
  sc.duration = Math.max(sc.duration, end + Math.round(fr * 0.5));
  report.endFrame = end; report.startFrame = start; report.character = layer.name;
  sc.aiLog.push({ time: Date.now(), summary: plan.summary, source: plan.source, plan: JSON.parse(JSON.stringify({ ...plan, warnings: undefined })), layerId: layer.id, start, end });
  return report;
}
function putKeyCam(cam, name, f, v) {
  const tr = (cam.tracks[name] = cam.tracks[name] || []);
  if (!tr.length && f > 0) setKey(tr, 0, cam.base[name], 'easeInOut');
  setKey(tr, f, v, 'easeInOut');
}
function normalizePose(p) {
  const out = {};
  for (const [r, v] of Object.entries(p || {})) {
    if (r === '_') { out._ = { ...v }; continue; }
    if (typeof v === 'number') out[r] = { r: v }; else if (v && typeof v === 'object') { out[r] = {}; for (const k of ['r', 'x', 'y', 'sx', 'sy']) if (Number.isFinite(+v[k])) out[r][k] = +v[k]; if (Number.isFinite(+v.rot)) out[r].r = +v.rot; }
  }
  return out;
}
export { normalizePose };
