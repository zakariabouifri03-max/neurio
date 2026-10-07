// AI Animation Assistant: prompt → plan (LLM via provider or offline planner) → editable keyframes.
import { S, scene, allLayers, curLayer, fps } from '../core/state.js';
import { H } from '../core/history.js';
import { getProvider, aiSettings } from './providers.js';
import { planFromText, sanitizePlan, extractJSON, PLAN_SCHEMA_DOC } from './planner.js';
import { compilePlan } from './compiler.js';
import { POSES, ALL_ROLES, findPose, CLIPS, setPoseAt } from '../core/motionlib.js';
import { BACKGROUNDS, PROPS } from '../core/scenegen.js';
import { createStarterCharacter } from '../core/charbuild.js';
import { insertLayer } from '../core/ops.js';

const SYSTEM = (ctx) => `You are the planning engine of a 2D animation editor. Convert the user's request into a JSON animation PLAN. Output ONLY JSON — no prose, no markdown.
The editor will compile the plan into editable keyframes for a rigged 2D character facing right. The canvas is ${ctx.width}x${ctx.height}px at ${ctx.fps} fps. Characters in scene: ${ctx.characters.join(', ') || 'none (a starter character will be created)'}.
Allowed backgrounds: ${Object.keys(BACKGROUNDS).join(', ')}. Allowed props: ${Object.keys(PROPS).join(', ')}. Known pose names: ${Object.keys(POSES).join(', ')}.
Schema (use only these fields):
${PLAN_SCHEMA_DOC}
Rules: keep durations realistic (walk 3–8 s, wave 1–3 s). "stop in the middle" = walk with "to":"center" then continue with another walk whose "from" is "center". Use "talk" with "text" for speech. Prefer several short steps over one custom step.`;

export function sceneContext() {
  const P = S.project;
  return { width: P.width, height: P.height, fps: P.fps, characters: allLayers(scene()).filter((l) => l.char).map((l) => l.name) };
}
/** Returns { plan, source: 'ai'|'offline', provider, raw, error? } */
export async function makePlan(prompt, { providerId } = {}) {
  const cfg = aiSettings(); const id = providerId || cfg.active; const provider = getProvider(id);
  if (!provider || provider.offline) { const plan = sanitizePlan({ ...planFromText(prompt), source: 'offline' }); return { plan, source: 'offline', provider: 'Offline planner' }; }
  try {
    const text = await provider.complete({ system: SYSTEM(sceneContext()), user: prompt, json: true });
    const raw = extractJSON(text); const plan = sanitizePlan({ ...raw, source: 'ai' });
    if (!plan.steps.length && !plan.background && !plan.props.length && !plan.camera.length) throw new Error('The AI returned a plan with no usable steps.');
    return { plan, source: 'ai', provider: provider.label, raw: text };
  } catch (e) {
    const plan = sanitizePlan({ ...planFromText(prompt), source: 'offline' });
    plan.warnings.unshift(`AI provider “${provider.label}” failed (${e.message || e}). Used the built-in offline planner instead.`);
    return { plan, source: 'offline-fallback', provider: 'Offline planner', error: String(e.message || e) };
  }
}
export function describePlan(plan) {
  const out = [];
  if (plan.background) out.push({ k: 'Background', d: BACKGROUNDS[plan.background] || plan.background });
  for (const p of plan.props) out.push({ k: 'Prop', d: PROPS[p.kind] || p.kind });
  plan.steps.forEach((s, i) => {
    const bits = [s.do]; if (s.from != null) bits.push(`from ${s.from}`); if (s.to != null) bits.push(`to ${s.to}`); if (s.seconds) bits.push(`${s.seconds}s`); if (s.count > 1) bits.push(`×${s.count}`); if (s.text) bits.push(`“${s.text}”`); if (s.name) bits.push(s.name);
    out.push({ k: `Step ${i + 1}`, d: bits.join(' · ') });
  });
  for (const c of plan.camera) out.push({ k: 'Camera', d: `${c.do}${c.to != null ? ' ' + c.to : ''} · ${c.seconds}s` });
  return out;
}
export function applyPlan(plan, opts = {}) {
  let report;
  H.tx('AI: ' + (plan.summary || 'animation plan').slice(0, 40), () => {
    report = compilePlan(plan, { start: opts.start ?? S.frame, layer: opts.layer || (curLayer() && curLayer().char ? curLayer() : null), createCharacter: () => { const l = createStarterCharacter('cartoon'); insertLayer(l); return l; } });
    const sc = scene(); sc.duration = Math.max(sc.duration, report.endFrame + 1);
    if (opts.prompt) { sc.aiLog = sc.aiLog || []; sc.aiLog.push({ t: Date.now(), prompt: opts.prompt, summary: plan.summary, source: plan.source }); if (sc.aiLog.length > 50) sc.aiLog.shift(); }
  });
  return report;
}

// ───────── AI Pose ─────────
const POSE_SYSTEM = `You pose a 2D humanoid character rig. Reply ONLY with JSON: {"pose":{"<role>":{"r":degrees}, ...}}. Roles: ${ALL_ROLES.join(', ')}. Angles are degrees relative to the rest pose (character faces right). Conventions: for a hanging limb, a NEGATIVE angle swings it forward, positive backward; the right arm raised outward is positive; "root" may use {"y":px} (positive = down). Knees (shin) bend positive. Typical ranges: head ±25, body ±20, upper arm ±150, fore arm 0..-120 (bends forward), thigh ±80, shin 0..120. Only include roles that differ from rest.`;
export async function aiPose(text, { providerId } = {}) {
  const cfg = aiSettings(); const provider = getProvider(providerId || cfg.active);
  const offline = () => { const n = findPose(text); if (!n) throw new Error(`I don't know a pose called “${text}” offline. Try: ${Object.keys(POSES).join(', ')} — or connect an AI provider in Settings ▸ AI.`); return { pose: POSES[n], name: n, source: 'offline' }; };
  if (!provider || provider.offline) return offline();
  try {
    const t = await provider.complete({ system: POSE_SYSTEM, user: `Pose: ${text}`, json: true }); const j = extractJSON(t); const pose = {};
    for (const [role, v] of Object.entries(j.pose || j)) { if (!ALL_ROLES.includes(role) || !v || typeof v !== 'object') continue; const o = {}; for (const k of ['r', 'x', 'y', 'sx', 'sy']) if (typeof v[k] === 'number' && isFinite(v[k])) o[k] = Math.max(-360, Math.min(360, v[k])); if (Object.keys(o).length) pose[role] = o; }
    if (!Object.keys(pose).length) throw new Error('empty pose');
    return { pose, name: text, source: 'ai' };
  } catch (e) { try { const r = offline(); r.warning = `AI failed (${e.message}); used built-in pose library.`; return r; } catch { throw e; } }
}
export function applyPose(layer, pose, f = S.frame) { H.tx('AI pose', () => setPoseAt(layer, f, pose)); }
