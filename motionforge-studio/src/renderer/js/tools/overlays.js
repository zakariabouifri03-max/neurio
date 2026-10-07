// Rig / gizmo overlays drawn in screen space.
import { M } from '../core/util.js';
import { S } from '../core/state.js';
import { evalLayer, solveCharacter, tailRest } from '../core/rig.js';

export function charSolve(layer, f = S.frame) {
  let ev = evalLayer(layer, f);
  if (S.ui.rigEdit) ev = { ...ev, rest: true };
  const sol = solveCharacter(layer, ev);
  return { ev, sol };
}
export function boneEnds(b, sol) {
  const W = sol.W[b.id];
  const head = M.pt(W, 0, 0);
  const tail = M.pt(W, b.len * Math.cos(b.a0 * Math.PI / 180), b.len * Math.sin(b.a0 * Math.PI / 180));
  return [head, tail];
}
export function overlayRig(g, layer, c2s, z) {
  if (!S.ui.showBones && !S.ui.rigEdit) return;
  const { sol } = charSolve(layer);
  const toS = (p) => M.pt(c2s, ...M.pt(sol.lm, p[0], p[1]));
  g.save();
  for (const b of sol.order) {
    const [h0, t0] = boneEnds(b, sol); const h = toS(h0), t = toS(t0);
    const sel = S.selection.boneId === b.id;
    const dx = t[0] - h[0], dy = t[1] - h[1], L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L; const w = Math.min(8, L * 0.18);
    g.beginPath(); g.moveTo(h[0], h[1]); g.lineTo(h[0] + dx * 0.15 + nx * w, h[1] + dy * 0.15 + ny * w); g.lineTo(t[0], t[1]); g.lineTo(h[0] + dx * 0.15 - nx * w, h[1] + dy * 0.15 - ny * w); g.closePath();
    g.fillStyle = sel ? 'rgba(255,180,84,.55)' : S.ui.rigEdit ? 'rgba(90,200,255,.35)' : 'rgba(90,200,255,.22)';
    g.strokeStyle = sel ? '#ffb454' : 'rgba(120,210,255,.8)'; g.lineWidth = sel ? 2 : 1; g.fill(); g.stroke();
    g.beginPath(); g.arc(h[0], h[1], sel ? 5 : 3.5, 0, 7); g.fillStyle = sel ? '#ffb454' : '#7fd6ff'; g.fill();
    if (S.ui.rigEdit) { g.beginPath(); g.arc(t[0], t[1], 3, 0, 7); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
    if (b.ik && b.ik.on !== false) { g.beginPath(); g.arc(t[0], t[1], 8, 0, 7); g.strokeStyle = '#ff6b6b'; g.lineWidth = 2; g.stroke(); g.beginPath(); g.arc(t[0], t[1], 2.5, 0, 7); g.fillStyle = '#ff6b6b'; g.fill(); }
    if (b.pin) { const p = M.pt(c2s, b.pin.x, b.pin.y); g.fillStyle = '#ffd23f'; g.fillRect(p[0] - 4, p[1] - 4, 8, 8); }
    if (S.ui.rigEdit && (sel || z > 0.4)) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '10px sans-serif'; g.fillText(b.name, h[0] + 6, h[1] - 6); }
  }
  g.restore();
}
