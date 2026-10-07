// Bone tool: create bone chains, drag joints, in rest pose ("Rig Edit" space).
import { M, uid, DEG, deg } from '../core/util.js';
import { S, bus, scene, curLayer, notify } from '../core/state.js';
import { H } from '../core/history.js';
import { tailRest } from '../core/rig.js';
import { TOOLS } from './tools.js';
import { charSolve } from './overlays.js';
import { VP } from '../ui/viewport.js';
import { toast } from '../ui/common.js';

let chain = null; // { parent, from:[x,y], cur:[x,y], last: bone }
let drag = null;
const SNAP = 10;

function localPt(l, p) { const lm = charSolve(l).sol.lm; return M.pt(M.inv(lm), p.x, p.y); }
function toScr(l, pt) { const lm = charSolve(l).sol.lm; return M.pt(VP.sceneToScreen(), ...M.pt(lm, pt[0], pt[1])); }
function joints(l) {
  const out = [];
  for (const b of l.char.bones) { out.push({ b, end: 'head', pt: [b.hx, b.hy] }); out.push({ b, end: 'tail', pt: tailRest(b) }); }
  return out;
}
function jointAt(l, p) {
  let best = null, bd = SNAP;
  for (const j of joints(l)) { const s = toScr(l, j.pt); const d = Math.hypot(s[0] - p.sx, s[1] - p.sy); if (d < bd) { bd = d; best = j; } }
  return best;
}
function sameJoint(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5; }
function setTail(b, x, y) { const dx = x - b.hx, dy = y - b.hy; b.len = Math.max(2, Math.hypot(dx, dy)); b.a0 = deg(Math.atan2(dy, dx)); }
function nextName(l) { let n = l.char.bones.length + 1; while (l.char.bones.some((b) => b.name === 'Bone ' + n)) n++; return 'Bone ' + n; }
function makeBone(l, parent, from, to) {
  const b = { id: uid('b'), name: nextName(l), role: null, parent: parent ? parent.id : null, hx: from[0], hy: from[1], len: 20, a0: 0, min: -180, max: 180, lockRot: false, ik: null, pin: null, z: parent ? (parent.z || 0) + 1 : 0, hidden: false, img: null, visemes: null };
  setTail(b, to[0], to[1]); l.char.bones.push(b); return b;
}
function parentFor(l, joint) {
  if (!joint) return null;
  if (joint.end === 'tail') return joint.b;
  return joint.b.parent ? l.char.bones.find((x) => x.id === joint.b.parent) : null;
}
function end() { chain = null; bus.emit('render'); }

TOOLS.bone = {
  cursor: 'crosshair',
  activate() { chain = null; const l = curLayer(); if (!l || !l.char) toast('Select a character layer (or create one from the Character menu) to edit its rig.', 'info', 4000); },
  down(p) {
    const l = curLayer(); if (!l || !l.char) { toast('Select a character layer first.', 'warn'); return; }
    if (l.locked) { toast('Layer is locked.', 'warn'); return; }
    if (p.e.button === 2) { end(); return; }
    const pt = localPt(l, p);
    if (chain) {
      H.begin('Add bone'); const b = makeBone(l, chain.parent, chain.from, pt); H.end();
      S.selection.boneId = b.id; chain = { parent: b, from: [b.hx + b.len * Math.cos(b.a0 * DEG), b.hy + b.len * Math.sin(b.a0 * DEG)], cur: pt }; notify('change'); bus.emit('selection'); return;
    }
    const j = jointAt(l, p);
    if (j) {
      const group = joints(l).filter((q) => sameJoint(q.pt, j.pt));
      drag = { l, group, start: [p.sx, p.sy], moved: false, joint: j, pt0: [...j.pt] }; H.begin('Move joint'); return;
    }
    // click on a bone body selects it; otherwise start a chain
    const near = l.char.bones.find((b) => { const t = tailRest(b); const dx = t[0] - b.hx, dy = t[1] - b.hy; const L2 = dx * dx + dy * dy || 1; const u = Math.max(0, Math.min(1, ((pt[0] - b.hx) * dx + (pt[1] - b.hy) * dy) / L2)); return Math.hypot(b.hx + dx * u - pt[0], b.hy + dy * u - pt[1]) * S.view.zoom < 6; });
    if (near) { S.selection.boneId = near.id; bus.emit('selection'); return; }
    const sel = l.char.bones.find((b) => b.id === S.selection.boneId);
    chain = { parent: null, from: pt, cur: pt, startFresh: true };
    void sel;
  },
  move(p) {
    if (!drag) return; const l = drag.l;
    if (!drag.moved && Math.hypot(p.sx - drag.start[0], p.sy - drag.start[1]) < 3) return; drag.moved = true;
    const pt = localPt(l, p);
    for (const q of drag.group) { if (q.end === 'head') { q.b.hx = pt[0]; q.b.hy = pt[1]; } }
    for (const q of drag.group) { if (q.end === 'tail') setTail(q.b, pt[0], pt[1]); }
    // heads moved change tails of bones headed there: recompute tails so tail points stay in place
    // (tail of a bone whose head moved: keep tail fixed → recompute len/a0)
    for (const q of drag.group) if (q.end === 'head') { /* tail stays: recompute from stored tail */ const tp = q.tail0 || (q.tail0 = tailRestFrom(q.b, drag.pt0)); setTail(q.b, tp[0], tp[1]); }
    bus.emit('render');
  },
  up(p) {
    if (!drag) return; const d = drag; drag = null;
    if (!d.moved) { H.cancel(); // plain click on a joint: start chain from it
      const l = d.l; const parent = parentFor(l, d.joint); chain = { parent, from: [...d.joint.pt], cur: [...d.joint.pt] }; if (d.joint.b) { S.selection.boneId = d.joint.b.id; bus.emit('selection'); } return; }
    H.end(); notify('change'); bus.emit('selection');
  },
  hover(p) { if (chain) { const l = curLayer(); if (l && l.char) chain.cur = localPt(l, p); } },
  dbl() { end(); },
  key(e) { if (e.key === 'Escape' || e.key === 'Enter') { if (chain) { end(); return true; } } return false; },
  overlay(g, c2s) {
    if (!chain) return; const l = curLayer(); if (!l || !l.char) return;
    const a = toScr(l, chain.from), b = toScr(l, chain.cur);
    g.strokeStyle = '#ffb454'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffb454'; g.beginPath(); g.arc(a[0], a[1], 4, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.8)'; g.font = '11px sans-serif'; g.fillText('Click to add bone · Enter / double-click to finish', b[0] + 10, b[1] - 8);
  },
};
function tailRestFrom(b, headBefore) { // original tail given the head position before drag began
  const dx = b.len * Math.cos(b.a0 * DEG), dy = b.len * Math.sin(b.a0 * DEG);
  return [headBefore[0] + dx, headBefore[1] + dy];
}
