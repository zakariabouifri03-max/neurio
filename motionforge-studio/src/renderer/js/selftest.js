// End-to-end self-test of the real UI (used by the packaged-app smoke test on CI and the headless dev test).
// Flow: create project → draw character art → frames → animate (AI plan) → keyframes → play → save → reopen → export.
import { S, bus, scene, allLayers, curLayer, fps } from './core/state.js';
import { startProject, saveProject, openPath } from './core/io.js';
import { TEMPLATES } from './core/templates.js';
import { runCommand } from './core/commands.js';
import { Playback } from './core/playback.js';
import { celCanvas, collectCelIds } from './core/model.js';
import { celAt } from './core/anim.js';
import { makePlan, applyPlan } from './ai/assistant.js';
import { runExport } from './ui/exporter.js';
import { VP } from './ui/viewport.js';
import { setTool } from './ui/cmds.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alphaCount = (cv) => { if (!cv) return 0; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n; };
function ptr(type, x, y) { const c = VP.canvas(); const r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 1, pointerType: 'pen', pressure: 0.6, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true })); }
async function stroke(pts) { ptr('pointerdown', ...VP.toScreen(...pts[0])); for (const p of pts.slice(1)) { ptr('pointermove', ...VP.toScreen(...p)); await sleep(5); } ptr('pointerup', ...VP.toScreen(...pts[pts.length - 1])); await sleep(30); }

export async function runSelfTest(info) {
  const steps = []; const mf = window.mf;
  const step = async (name, fn) => { const t0 = performance.now(); try { const d = await fn(); steps.push({ name, ok: true, detail: d === undefined ? '' : String(d), ms: Math.round(performance.now() - t0) }); } catch (e) { steps.push({ name, ok: false, detail: String(e && e.stack || e) }); } };
  const need = (c, m) => { if (!c) throw new Error(m); };
  const dir = info.userData; const file = dir.replace(/\\/g, '/') + '/selftest.mfs';
  await step('shell: menus, toolbar, panels exist', () => {
    const q = (s) => document.querySelectorAll(s).length;
    need(q('#menubar .menu-top') === 8, 'expected 8 menus, got ' + q('#menubar .menu-top'));
    need(q('#toolbar .tool') >= 10, 'toolbar tools: ' + q('#toolbar .tool')); need(q('#right-tabs .tab') >= 8, 'right tabs'); need(q('#dock-tabs .tab') === 3, 'dock tabs');
    need(document.querySelector('#canvas-host canvas'), 'canvas'); return `${q('#toolbar .tool')} tools, ${q('#right-tabs .tab')} panels`;
  });
  await step('new project (Blank, 960×540 @ 24fps)', async () => { const t = TEMPLATES.find((x) => x.id === 'blank'); startProject({ template: t, name: 'SelfTest', width: 960, height: 540, fps: 24, bg: '#ffffff' }); await sleep(200); VP.fit(); need(S.project.fps === 24, 'fps'); need(curLayer(), 'no layer selected'); });
  await step('draw with the brush tool (pen pressure)', async () => {
    setTool('brush'); await sleep(50); S.color = '#cc3322';
    await stroke([[200, 200], [260, 150], [330, 160], [380, 230], [340, 300], [260, 310], [210, 260], [200, 200]]);
    const l = curLayer(); const c = celAt(l, 0); need(c && c.id, 'no cel created'); const n = alphaCount(celCanvas(c.id)); need(n > 500, 'stroke pixels: ' + n); return n + ' px';
  });
  await step('frame-by-frame: new frame + draw + onion', async () => {
    S.frame = 0; runCommand('frame.new'); S.frame = 1; bus.emit('frame'); runCommand('frame.new'); await sleep(30);
    const l = curLayer(); need(l.cels.length >= 2, 'cels ' + l.cels.length);
    S.frame = 2; await stroke([[420, 200], [520, 240], [610, 200]]); need(alphaCount(celCanvas(celAt(l, 2).id)) > 200, 'frame 3 empty');
    runCommand('view.onion'); S.frame = 1; bus.emit('render'); return l.cels.length + ' drawings';
  });
  await step('undo / redo', async () => { const l = curLayer(); const before = alphaCount(celCanvas(celAt(l, 2).id)); runCommand('edit.undo'); await sleep(30); const mid = alphaCount(celCanvas(celAt(l, 2).id)); runCommand('edit.redo'); await sleep(30); const after = alphaCount(celCanvas(celAt(l, 2).id)); need(mid < before && after === before, `undo/redo ${before}/${mid}/${after}`); });
  await step('character + AI Animation Assistant (offline planner)', async () => {
    runCommand('char.add.cartoon'); await sleep(50); const ch = allLayers(scene()).find((l) => l.char); need(ch, 'character not added'); S.selection.layerId = ch.id; S.frame = 0;
    const r = await makePlan('Make the character walk from the left side to the center, stop, wave, then continue walking to the right.'); need(r.plan.steps.length >= 3, 'plan steps ' + r.plan.steps.length);
    const rep = applyPlan(r.plan, { start: 0, prompt: 'selftest' }); need(rep.endFrame > 60, 'end frame ' + rep.endFrame);
    const keys = Object.values(ch.tracks).reduce((a, t) => a + t.length, 0); need(keys > 40 && ch.tracks.x.length >= 3, 'keys ' + keys); return `${r.plan.steps.length} steps → ${keys} keyframes`;
  });
  await step('keyframes (K) + easing', async () => { const ch = curLayer(); S.frame = 10; runCommand('key.new'); need(ch.tracks.x.some((k) => k.f === 10), 'no key at 10'); ch.tracks.x.find((k) => k.f === 10).e = 'bounce'; });
  await step('lip sync from script', async () => { const { scriptToFrames, applyVisemeFrames } = await import('./core/lipsync.js'); const ch = curLayer(); const seq = scriptToFrames('Hello there, nice to meet you', 48); const n = await applyVisemeFrames(ch, seq, 0); need(n > 6 && ch.tracks.mouth.length > 6, 'mouth keys ' + n); return n + ' mouth keys'; });
  await step('playback runs', async () => { S.frame = 0; Playback.play(); await sleep(500); const f = S.frame; Playback.pause(); need(f >= 6 && f <= 20, 'frame after 0.5s = ' + f); return 'frame ' + f; });
  const lc = allLayers(scene()).length;
  await step('save .mfs', async () => { S.filePath = file; const ok = await saveProject(false); need(ok, 'saveProject returned false'); const st = await mf.file.stat(file); need(st && st.size > 1000, 'file size'); return st.size + ' bytes'; });
  await step('reopen .mfs', async () => { S.dirty = false; const ok = await openPath(file); need(ok, 'openPath failed'); await sleep(200); need(allLayers(scene()).length === lc, `layers ${allLayers(scene()).length} != ${lc}`); const ch = allLayers(scene()).find((l) => l.char); need(ch && ch.tracks.x.length >= 3 && ch.tracks.mouth.length > 6, 'animation lost'); const pl = allLayers(scene()).find((l) => l.type === 'draw'); need(alphaCount(celCanvas(celAt(pl, 0).id)) > 500, 'drawing lost'); return 'layers ' + lc; });
  const caps = await mf.ffmpeg.caps().catch(() => ({ available: false }));
  await step('export PNG sequence', async () => { const out = dir.replace(/\\/g, '/') + '/seq'; const r = await runExport({ format: 'png', height: 360, fps: 12, range: 'all', scope: 'scene', transparent: true, audio: false, dir: out, baseName: 'f' }, () => {}, { canceled: false }); need(r.frames > 5, 'frames ' + r.frames); return r.frames + ' png'; });
  await step('export MP4 video (FFmpeg)', async () => {
    need(caps.available, 'FFmpeg missing: ' + JSON.stringify(caps)); const out = dir.replace(/\\/g, '/') + '/out.mp4';
    const r = await runExport({ format: 'mp4', height: 360, fps: 24, range: 'all', scope: 'scene', transparent: false, audio: false, outPath: out, crf: 24, preset: 'veryfast' }, () => {}, { canceled: false });
    need(r.ok && r.size > 2000, 'mp4 size ' + r.size); return `${r.frames} frames, ${r.size} bytes`;
  });
  const ok = steps.every((s) => s.ok);
  const report = { ok, steps, caps: { available: caps.available, h264: caps.h264, vp9: caps.vp9, gif: caps.gif }, versions: { electron: info.electron, chrome: info.chrome } };
  window.__selftest = report;
  if (mf.app.selftestDone) await mf.app.selftestDone(report);
}
