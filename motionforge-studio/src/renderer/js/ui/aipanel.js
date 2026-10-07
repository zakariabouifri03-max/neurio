// AI Animation Assistant panel: natural language → editable keyframes, AI Pose, history.
import { h } from '../core/util.js';
import { S, bus, scene, curLayer, allLayers } from '../core/state.js';
import { aiSettings, getProvider } from '../ai/providers.js';
import { makePlan, describePlan, applyPlan, aiPose, applyPose } from '../ai/assistant.js';
import { createStarterCharacter } from '../core/charbuild.js';
import { insertLayer } from '../core/ops.js';
import { H } from '../core/history.js';
import { toast } from './common.js';
import { button, section } from './common.js';
import { POSES } from '../core/motionlib.js';
import { icon } from './icons.js';

const EXAMPLES = [
  'Make the character walk from the left side to the center, stop, wave, then continue walking to the right.',
  'Create a character walking into a room, sit on a chair and wave.',
  'Make the character run for 3 seconds, then jump twice and stand still.',
  'The character turns around, nods, and says hello.',
  'Dance for 4 seconds and then bow.',
  'Camera zooms in on the character while they talk.',
];
const ui = { prompt: '', plan: null, result: null, busy: false, poseText: '' };

export function aiPanel(el) {
  el.innerHTML = '';
  const cfg = aiSettings(); let prov; try { prov = getProvider(); } catch { prov = null; }
  const offline = !prov || prov.offline;
  const head = h('div.ai-head', h('span.pill' + (offline ? '' : '.on'), offline ? 'Offline planner' : prov.label),
    h('a.link', { on: { click: () => import('./dialogs.js').then((m) => m.settingsDialog('ai')) } }, 'AI settings…'));
  const ta = h('textarea.ai-prompt', { rows: 4, placeholder: 'Describe the animation, e.g. “Make the character walk to the center, stop, and wave.”', on: { input: () => { ui.prompt = ta.value; }, keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(false); } } } }); ta.value = ui.prompt;
  const out = h('div.ai-out');
  const ex = h('div.chips', EXAMPLES.map((t) => h('span.chip.sm', { title: t, on: { click: () => { ta.value = ui.prompt = t; ta.focus(); } } }, t.length > 34 ? t.slice(0, 33) + '…' : t)));
  const genBtn = button('Generate plan', () => run(false), { cls: 'primary', ic: 'sparkle', tip: 'Turn the description into a step-by-step plan you can review (Ctrl+Enter)' });
  const quick = button('Generate & apply', () => run(true), { tip: 'Generate and apply to the timeline in one go. You can always Undo (Ctrl+Z).' });
  el.append(head,
    section('Text → Animation', h('div.hint', 'The assistant produces editable keyframes and bone data on the timeline — not a video. Everything it creates can be tweaked, undone, or regenerated.'), ta, h('div.flex', genBtn, quick), ex),
    out,
    section('AI Pose', h('div.hint', 'Describe a pose for the selected character at the playhead.'),
      (() => { const inp = h('input.txt', { placeholder: 'e.g. thinking pose, victory, tired, wave hello', value: ui.poseText, on: { input: () => { ui.poseText = inp.value; }, keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') doPose(); } } }); return h('div.row.ai-pose', inp, button('Pose', () => doPose(), { cls: 'small primary' })); })(),
      h('div.chips', Object.keys(POSES).slice(0, 12).map((p) => h('span.chip.sm', { on: { click: () => { ui.poseText = p; doPose(p); } } }, p)))),
    historySection());
  drawOut();
  async function run(apply) {
    const text = ta.value.trim(); if (!text) { toast('Describe what the character should do first.', 'info'); return; }
    if (ui.busy) return; ui.busy = true; genBtn.disabled = quick.disabled = true; out.innerHTML = ''; out.append(h('div.hint.thinking', 'Thinking…'));
    try { const r = await makePlan(text); ui.plan = r; ui.prompt = text; ui.busy = false; genBtn.disabled = quick.disabled = false; drawOut(); if (apply) applyCurrent(); }
    catch (e) { ui.busy = false; genBtn.disabled = quick.disabled = false; out.innerHTML = ''; out.append(h('div.err', 'Could not create a plan: ' + (e.message || e))); }
  }
  function applyCurrent() {
    if (!ui.plan) return;
    try {
      const rep = applyPlan(ui.plan.plan, { start: S.frame, prompt: ui.prompt });
      toast(`Applied: ${rep.steps} step${rep.steps === 1 ? '' : 's'}, frames ${rep.startFrame + 1}–${rep.endFrame + 1}. Edit it on the timeline or press Ctrl+Z to undo.`, 'success', 5000);
      ui.result = rep; bus.emit('selection'); bus.emit('render'); drawOut();
    } catch (e) { console.error(e); toast('Could not apply the plan: ' + (e.message || e), 'error', 6000); }
  }
  function drawOut() {
    out.innerHTML = ''; if (!ui.plan) return;
    const { plan, source, provider, error } = ui.plan;
    const rows = describePlan(plan).map((r) => h('div.plan-row', h('b', r.k), h('span', r.d)));
    const warns = (plan.warnings || []).map((w) => h('div.warn', icon('alert', 14) && h('span', { html: icon('alert', 14) }), ' ', w));
    out.append(section(`Plan${source === 'ai' ? ' · ' + provider : ' · built-in planner'}`, plan.summary ? h('div.hint', plan.summary) : null, ...rows, ...warns,
      h('div.flex', button('Apply to timeline', applyCurrent, { cls: 'primary', ic: 'play', tip: `Insert at frame ${S.frame + 1} as one undoable action` }), button('Discard', () => { ui.plan = null; drawOut(); }, { cls: 'small' }))));
  }
  async function doPose(name) {
    const l = curLayer(); if (!l || !l.char) { toast('Select a character layer first.', 'warn'); return; }
    const text = name || ui.poseText.trim(); if (!text) return;
    try { const r = await aiPose(text); applyPose(l, r.pose, S.frame); toast(`Pose “${r.name || text}” applied at frame ${S.frame + 1}.${r.warning ? ' ' + r.warning : ''}`, r.warning ? 'warn' : 'success', 3500); bus.emit('render'); bus.emit('change'); }
    catch (e) { toast(e.message || String(e), 'warn', 6000); }
  }
}
function historySection() {
  const log = (scene().aiLog || []).slice(-6).reverse();
  return section('Recent prompts', ...(log.length ? log.map((l) => h('div.hist', { title: 'Click to reuse', on: { click: () => { ui.prompt = l.prompt; bus.emit('ai-reuse'); } } }, l.prompt)) : [h('div.hint', 'Nothing yet.')]));
}
bus.on('ai-reuse', () => { const t = document.querySelector('.ai-prompt'); if (t) { t.value = ui.prompt; t.focus(); } });
