// Offline natural-language → animation plan. Produces the same JSON schema an LLM provider is asked to produce.
import { findPose } from '../core/motionlib.js';

export const PLAN_SCHEMA_DOC = `{
  "summary": "short description",
  "background": "room|house|street|school|park|beach|night|space|studio|null",
  "props": [{"kind":"chair|table|ball|box|tree|sun|lamp|door|bench"}],
  "camera": [{"do":"zoom|pan|follow|shake|closeup","to":1.3,"seconds":1.5,"at":"start|end|<step index>"}],
  "steps": [  // played one after another, all about the main character
    {"do":"walk|run","from":"offscreen-left|left|center|right|offscreen-right|<px>","to":"center|left|right|offscreen-left|offscreen-right|<px>","seconds":3},
    {"do":"jump","count":1,"seconds":1},
    {"do":"wave","hand":"R|L","seconds":2},
    {"do":"idle","seconds":1},
    {"do":"turn","to":"left|right"},
    {"do":"sit"}, {"do":"stand"}, {"do":"dance","seconds":3}, {"do":"point","hand":"R"}, {"do":"talk","seconds":2,"text":"hello"},
    {"do":"lookAround"}, {"do":"nod"}, {"do":"shake"}, {"do":"sleep"}, {"do":"surprise"},
    {"do":"pose","name":"running|jumping|sitting|fighting|waving|dancing|surprised|sleeping|pointing|thinking|happy|sad","seconds":0.6},
    {"do":"custom","keys":[{"t":0,"pose":{"head":{"r":10}}},{"t":1,"pose":{}}]}
  ]
}
Pose roles: root, body, head, upperArmL/R, foreArmL/R, handL/R, thighL/R, shinL/R, footL/R. Each role takes {"r":degrees,"x":px,"y":px,"sx":scale,"sy":scale}.`;

const WORD_NUM = { one: 1, a: 1, once: 1, two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, ten: 10 };
const num = (s) => (s == null ? null : (/^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : WORD_NUM[s.toLowerCase()] ?? null));

const BG_WORDS = [
  [/\b(classroom|school|playground)\b/, 'school'], [/\b(street|road|sidewalk|city|town|avenue)\b/, 'street'], [/\b(beach|seaside|shore|ocean|sea)\b/, 'beach'],
  [/\b(park|garden|forest|woods|meadow|field)\b/, 'park'], [/\b(night|midnight|evening)\b/, 'night'], [/\b(space|galaxy|planet|moon)\b/, 'space'],
  [/\b(living room|house|home|apartment)\b/, 'house'], [/\b(room|bedroom|kitchen|office|hall)\b/, 'room'],
];
const PROP_WORDS = [[/\b(chair|stool|seat)\b/, 'chair'], [/\bbench\b/, 'bench'], [/\b(sofa|couch)\b/, 'bench'], [/\btable|desk\b/, 'table'], [/\bball\b/, 'ball'], [/\b(box|crate|package)\b/, 'box'], [/\btree\b/, 'tree'], [/\bsun\b/, 'sun'], [/\blamp\b/, 'lamp'], [/\bdoor\b/, 'door']];

function splitClauses(text) {
  let t = ' ' + text.replace(/\s+/g, ' ').trim() + ' ';
  t = t.replace(/\b(and then|after that|afterwards|then|next|finally|later|before long|and finally)\b/gi, ' | ');
  t = t.replace(/[.;!]+/g, ' | ');
  t = t.replace(/,/g, ' | ');
  const verbs = '(?:walk|run|jump|wave|sit|stand|dance|point|turn|look|stop|talk|say|speak|nod|shake|sleep|continue|hop|sprint|leap|greet|pause|wait|spin|enter|exit|zoom|pan|follow)';
  t = t.replace(new RegExp(`\\s+and\\s+(?=(?:the\\s+|he\\s+|she\\s+|it\\s+)?${verbs}\\w*)`, 'gi'), ' | ');
  return t.split('|').map((s) => s.trim()).filter(Boolean);
}
function seconds(c) {
  let m = /(?:for|over|in|during|about)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|ten)\s*(?:seconds?|secs?|s)\b/i.exec(c);
  if (m) return num(m[1]);
  m = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/i.exec(c); if (m) return parseFloat(m[1]);
  m = /(\d+(?:\.\d+)?)\s*(?:minutes?)\b/i.exec(c); if (m) return parseFloat(m[1]) * 60;
  return null;
}
function count(c) {
  let m = /\b(\d+|two|three|four|five|six|ten)\s*(?:times|x)\b/i.exec(c); if (m) return num(m[1]);
  if (/\btwice\b/i.test(c)) return 2; if (/\bthrice\b/i.test(c)) return 3; return 1;
}
function hand(c) { if (/\bleft\s+(?:hand|arm)\b/i.test(c)) return 'L'; if (/\bright\s+(?:hand|arm)\b/i.test(c)) return 'R'; return 'R'; }
function place(token) {
  token = (token || '').toLowerCase();
  if (/middle|center|centre/.test(token)) return 'center';
  if (/off\s*screen|offscreen|out of|exit/.test(token)) return null;
  return token;
}

export function planFromText(text) {
  const plan = { summary: text.trim().slice(0, 140), background: null, props: [], camera: [], steps: [], warnings: [], source: 'offline' };
  const low = text.toLowerCase();
  for (const [re, k] of BG_WORDS) if (re.test(low)) { plan.background = k; break; }
  for (const [re, k] of PROP_WORDS) if (re.test(low) && !plan.props.some((p) => p.kind === k)) plan.props.push({ kind: k });
  const clauses = splitClauses(text);
  let traverse = null; // remember a full traverse to resume it with "continue"
  let last = null;
  clauses.forEach((cl, i) => {
    const c = cl.toLowerCase().replace(/^(?:make|let|have|get)\s+(?:the\s+|my\s+)?(?:character|figure|hero|person|guy|girl|boy|man|woman|him|her|it)\s+(?:to\s+)?/, '').replace(/^(?:the\s+)?(?:character|he|she|it|they)\s+/, '').trim();
    const next = (clauses[i + 1] || '').toLowerCase();
    const secs = seconds(c);
    // camera
    if (/\bcamera\b|zoom|close-?up|\bpan\b|\bpans\b/.test(c) && !/\b(walk|run|jump|wave|sit|dance)\b/.test(c)) {
      if (/shake|rumble|earthquake/.test(c)) plan.camera.push({ do: 'shake', seconds: secs || 1, at: 'step', step: plan.steps.length });
      else if (/follow/.test(c)) plan.camera.push({ do: 'follow', at: 'start' });
      else if (/zoom\s*out|pull\s*back|wide/.test(c)) plan.camera.push({ do: 'zoom', to: 0.8, seconds: secs || 1.5, at: 'step', step: plan.steps.length });
      else if (/close-?up/.test(c)) plan.camera.push({ do: 'closeup', seconds: secs || 1.2, at: 'step', step: plan.steps.length });
      else if (/\bpan/.test(c)) plan.camera.push({ do: 'pan', to: /left/.test(c) ? 'left' : 'right', seconds: secs || 2, at: 'step', step: plan.steps.length });
      else plan.camera.push({ do: 'zoom', to: 1.35, seconds: secs || 1.5, at: 'step', step: plan.steps.length });
      return;
    }
    if (/^(?:and\s+)?(?:stop|pause|halt|wait|freeze|stay|rest|hold|stand still|stand there)\b/.test(c) || /\bstops?\b/.test(c) && !/walk|run/.test(c)) {
      const s = { do: 'idle', seconds: secs || 1 };
      const prev = plan.steps[plan.steps.length - 1];
      if (/middle|center|centre/.test(c) && prev && (prev.do === 'walk' || prev.do === 'run') && (!prev.to || prev.to === traverse?.to || prev.fullTraverse)) { prev.to = 'center'; }
      plan.steps.push(s); last = s; return;
    }
    if (/\bcontinue\b|\bresume\b|\bkeep (?:walking|running|going)\b|\bgo on\b/.test(c)) {
      const kind = /run|jog|sprint/.test(c) || (last && last.do === 'run' && !/walk/.test(c)) ? 'run' : 'walk';
      const s = { do: kind, from: 'current', to: traverse ? traverse.to : 'right', seconds: secs || undefined };
      plan.steps.push(s); last = s; return;
    }
    const RUNRE = /\b(?:run|runs|running|sprint|sprints|dash|dashes|jog|jogs|race|races|rush|rushes)\b/;
    const MOVERE = /\b(?:walk|walks|walking|stroll\w*|march\w*|wander\w*|enters?|approach\w*)\b|\b(?:go|goes|going|move|moves|moving|come|comes|head|heads)\s+(?:to|towards?|into|across|left|right|forward|back|away|in|out)\b/;
    if (RUNRE.test(c) || MOVERE.test(c)) {
      if (/\b(sit|sits)\b/.test(c) && !/walk|run/.test(c)) { /* fallthrough to sit */ } else {
        const isRun = /\b(?:run|runs|running|sprint|dash|jog|race|rush)\b/.test(c);
        const s = { do: isRun ? 'run' : 'walk' };
        let m;
        if ((m = /from\s+(?:the\s+)?(left|right|middle|center|centre)(?:\s+side)?\s+(?:to|towards?|until)\s+(?:the\s+)?(left|right|middle|center|centre)/.exec(c))) { s.from = place(m[1]); s.to = place(m[2]); s.fullTraverse = true; traverse = { to: s.to }; }
        else if (/\binto\b.*\b(room|house|scene|school|park|street|frame)\b|\benters?\b|\bwalks? in\b|\bcomes? in\b/.test(c)) { s.from = 'offscreen-left'; s.to = 'center'; traverse = { to: 'center' }; }
        else if (/\b(?:off\s?screen|away|exit|leave|out of)\b/.test(c)) { s.to = /left/.test(c) ? 'offscreen-left' : 'offscreen-right'; }
        else if ((m = /\b(?:to|towards?|until)\s+(?:the\s+)?(left|right|middle|center|centre)\b/.exec(c))) { s.to = place(m[1]); if (s.to === 'left' || s.to === 'right') traverse = { to: s.to }; }
        else if (/\bleft\b/.test(c)) s.to = 'left'; else if (/\bright\b/.test(c)) s.to = 'right';
        if (/\bback\b/.test(c) && !s.to) s.to = 'left';
        if (/\b(?:slow|slowly|calmly|leisurely)\b/.test(c)) s.speed = 0.7; if (/\b(?:fast|quickly|rapidly|swiftly)\b/.test(c)) s.speed = 1.4;
        if (secs) s.seconds = secs;
        if (/\bstop|pause\b/.test(next) && /middle|center|centre/.test(next) && !s.to) { s.to = 'center'; }
        plan.steps.push(s); last = s; return;
      }
    }
    let m;
    if (/\b(?:jump|jumps|jumping|hop|hops|leap|leaps|bounce)\b/.test(c)) { const s = { do: 'jump', count: Math.min(10, count(c)) }; if (secs) s.seconds = secs; plan.steps.push(s); last = s; return; }
    if (/\b(?:wave|waves|waving|greet|greets|say hello|say hi|salute)\b/.test(c)) { const s = { do: 'wave', hand: hand(c), seconds: secs || 2 }; plan.steps.push(s); last = s; return; }
    if (/\b(?:stand up|stands up|get up|gets up|rise|rises|stands)\b/.test(c)) { plan.steps.push({ do: 'stand' }); last = null; return; }
    if (/\b(?:sit|sits|sitting|sat)\b/.test(c)) { plan.steps.push({ do: 'sit' }); if (!plan.props.some((p) => ['chair', 'bench'].includes(p.kind))) plan.props.push({ kind: 'chair' }); return; }
    if (/\b(?:dance|dances|dancing|boogie)\b/.test(c)) { plan.steps.push({ do: 'dance', seconds: secs || 4 }); return; }
    if (/\b(?:point|points|pointing)\b/.test(c)) { plan.steps.push({ do: 'point', hand: hand(c) }); return; }
    if (/\blook(?:s|ing)?\s+around\b|\bglance|\bscan|\bexplore|\bsearch/.test(c)) { plan.steps.push({ do: 'lookAround' }); return; }
    if (/\bturn(?:s|ing)?\s+(?:around|back|left|right)|\bspin|\bflip\b/.test(c)) { plan.steps.push({ do: 'turn', to: /left/.test(c) ? 'left' : /right/.test(c) ? 'right' : undefined }); return; }
    if (/\b(?:talk|talks|speak|speaks|say|says|chat|tell|tells|shout|explain)\b/.test(c)) { const q = /["“']([^"”']+)["”']/.exec(cl); plan.steps.push({ do: 'talk', seconds: secs || 2.5, text: q ? q[1] : undefined }); return; }
    if (/\bnod|nods|agree/.test(c)) { plan.steps.push({ do: 'nod' }); return; }
    if (/\bshake|shakes\b.*\bhead|\bdisagree|\bno\b/.test(c)) { plan.steps.push({ do: 'shake' }); return; }
    if (/\b(?:sleep|sleeps|nap|rest his head|lie down|lies down|fall asleep)\b/.test(c)) { plan.steps.push({ do: 'sleep' }); return; }
    if (/\b(?:surprised|gasp|gasps|shock|shocked|startle|startled)\b/.test(c)) { plan.steps.push({ do: 'surprise' }); return; }
    const pn = findPose(c);
    if (pn) { plan.steps.push({ do: 'pose', name: pn, seconds: 0.6 }); return; }
    if (/^(?:idle|breathe|breathes)\b/.test(c)) { plan.steps.push({ do: 'idle', seconds: secs || 2 }); return; }
    plan.warnings.push(`Could not understand: “${cl}”`);
  });
  if (!plan.steps.length && !plan.camera.length) plan.warnings.push('No actions were recognised. Try phrases like “walk left to right, wave, then jump”.');
  return plan;
}

// ── plan validation (applies to LLM output too) ──
const STEPS = new Set(['walk', 'run', 'jump', 'wave', 'idle', 'turn', 'sit', 'stand', 'dance', 'point', 'talk', 'lookAround', 'nod', 'shake', 'sleep', 'surprise', 'pose', 'custom']);
const BGS = new Set(['room', 'house', 'street', 'school', 'park', 'beach', 'night', 'space', 'studio']);
const PROPS_OK = new Set(['chair', 'table', 'ball', 'box', 'tree', 'sun', 'lamp', 'door', 'bench']);
const nz = (v, lo, hi, d) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function sanitizePlan(raw) {
  const plan = { summary: String((raw && raw.summary) || '').slice(0, 200), background: null, props: [], camera: [], steps: [], warnings: [...((raw && raw.warnings) || [])], source: (raw && raw.source) || 'ai' };
  if (!raw || typeof raw !== 'object') { plan.warnings.push('Plan was empty'); return plan; }
  if (raw.background && BGS.has(String(raw.background).toLowerCase())) plan.background = String(raw.background).toLowerCase();
  for (const p of raw.props || []) { const k = String(p && (p.kind || p)).toLowerCase(); if (PROPS_OK.has(k) && !plan.props.some((q) => q.kind === k)) plan.props.push({ kind: k }); }
  for (const s of raw.steps || []) {
    if (!s || typeof s !== 'object') continue;
    const d = String(s.do || s.type || '').replace(/_/g, '');
    const key = [...STEPS].find((x) => x.toLowerCase() === d.toLowerCase());
    if (!key) { plan.warnings.push('Skipped unknown step: ' + d); continue; }
    const o = { do: key };
    if (s.seconds != null) o.seconds = nz(s.seconds, 0.15, 120, undefined);
    if (s.from != null) o.from = typeof s.from === 'number' ? s.from : String(s.from);
    if (s.to != null) o.to = typeof s.to === 'number' ? s.to : String(s.to);
    if (s.fullTraverse) o.fullTraverse = true;
    if (s.count != null) o.count = Math.round(nz(s.count, 1, 20, 1));
    if (s.hand) o.hand = /^l/i.test(s.hand) ? 'L' : 'R';
    if (s.speed != null) o.speed = nz(s.speed, 0.3, 3, 1);
    if (s.text) o.text = String(s.text).slice(0, 300);
    if (s.name) o.name = String(s.name).slice(0, 40);
    if (s.pose && typeof s.pose === 'object') o.pose = s.pose;
    if (key === 'custom' && Array.isArray(s.keys)) o.keys = s.keys.slice(0, 60).map((k) => ({ t: nz(k.t, 0, 120, 0), pose: k.pose && typeof k.pose === 'object' ? k.pose : {}, ease: k.ease })).sort((a, b) => a.t - b.t);
    if (key === 'custom' && !(o.keys && o.keys.length)) continue;
    plan.steps.push(o);
  }
  for (const c of raw.camera || []) {
    if (!c || typeof c !== 'object') continue;
    const d = String(c.do || '').toLowerCase();
    if (!['zoom', 'pan', 'follow', 'shake', 'closeup'].includes(d)) continue;
    plan.camera.push({ do: d, to: c.to, seconds: nz(c.seconds, 0.2, 60, 1.5), at: c.at ?? 'start', step: c.step ?? (Number.isInteger(c.at) ? c.at : undefined) });
  }
  return plan;
}
export function extractJSON(text) {
  let t = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t); if (fence) t = fence[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The AI response did not contain JSON.');
  return JSON.parse(t.slice(a, b + 1));
}
