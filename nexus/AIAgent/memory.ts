// ============================================================================
// NEXUS AI AGENT — Project memory & retrieval
// Maintains a compact project context (architecture, systems, key objects,
// decisions, known bugs) plus a keyword index. The agent retrieves only the
// relevant slices per request — never the whole project.
// ============================================================================
import { store } from '../Editor/store';
import type { ProjectData } from '../Engine/core/types';

export interface RetrievedContext {
  summary: string;
  systems: string[];
  keyObjects: { id: string; name: string; role: string }[];
  relevantObjects: { name: string; components: string[]; tags: string[] }[];
  relevantScripts: { id: string; name: string; excerpt?: string }[];
  recentDecisions: string[];
  knownBugs: string[];
  problems: { file: string; line: number; message: string }[];
}

/** Rebuild memory summaries from the current project (called after AI batches & saves). */
export function refreshMemory(reason = 'update') {
  const p = store.project;
  if (!p) return;
  const m = p.aiMemory;
  const systems = new Set<string>(m.systems ?? []);
  const scene = p.scenes.find(s => s.id === p.settings.entrySceneId) ?? p.scenes[0];
  const counts: Record<string, number> = {};
  for (const s of p.scenes) for (const o of s.objects) for (const c of o.components) counts[c.type] = (counts[c.type] ?? 0) + 1;
  for (const [type, n] of Object.entries(counts)) {
    if (['ThirdPersonController', 'FirstPersonController', 'TopDownController'].includes(type)) systems.add('player-controller');
    if (type === 'NPC') systems.add(`npc-ai ×${n}`);
    if (type === 'DayNightCycle') systems.add('day-night-cycle');
    if (type === 'Spawner') systems.add(`spawners ×${n}`);
    if (type === 'Pickup') systems.add(`pickups ×${n}`);
    if (type === 'Inventory') systems.add('inventory');
    if (type === 'Weapon') systems.add('melee-combat');
    if (type === 'Projectile') systems.add('projectiles');
    if (type === 'Terrain') systems.add('terrain');
    if (type === 'Water') systems.add('water');
    if (type === 'SaveSystem') systems.add('save-system');
    if (type === 'GameRules') systems.add('game-rules');
    if (type === 'CraftRecipe' || p.recipes.length) systems.add(`crafting (${p.recipes.length} recipes)`);
    if (type === 'Door') systems.add(`doors ×${n}`);
    if (type === 'Health') systems.add('health-system');
  }
  if (p.uiDocuments.length) systems.add(`ui (${p.uiDocuments.map(d => d.name).join(', ')})`);
  m.systems = [...systems];
  m.architecture = [
    `${p.scenes.length} scene(s); entry: "${scene?.name ?? 'none'}"`,
    `${scene?.objects.length ?? 0} objects in entry scene`,
    `${p.assets.length} assets (${p.assets.filter(a => a.type === 'model').length} models, ${p.assets.filter(a => a.type === 'material').length} materials, ${p.assets.filter(a => a.type === 'prefab').length} prefabs)`,
    `${Object.keys(p.scripts).length} scripts, ${p.uiDocuments.length} UI documents`,
  ];
  // key objects: controllers, NPCs, spawners, day/night, save
  m.keyObjects = [];
  for (const s of p.scenes) for (const o of s.objects) {
    const role = o.components.find(c => ['ThirdPersonController', 'FirstPersonController', 'TopDownController', 'NPC', 'Spawner', 'DayNightCycle', 'SaveSystem', 'GameRules', 'Terrain'].includes(c.type))?.type;
    if (role) m.keyObjects.push({ id: o.id, name: o.name, role });
  }
  // script index
  m.index.scripts = Object.values(p.scripts).map(s => ({
    id: s.id, name: s.name,
    keywords: (s.name + ' ' + s.source.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 4).slice(0, 40).join(' ')).toLowerCase().slice(0, 900),
  }));
  m.summary = `"${p.name}" — ${m.systems.slice(0, 8).join(', ') || 'empty project'}.`;
}

export function rememberDecision(text: string) {
  const p = store.project;
  if (!p) return;
  p.aiMemory.decisions.push({ time: new Date().toISOString(), text });
  if (p.aiMemory.decisions.length > 60) p.aiMemory.decisions.shift();
}

export function rememberBug(text: string, resolved = false) {
  const p = store.project;
  if (!p) return;
  const existing = p.aiMemory.knownBugs.find(b => b.text === text && !b.resolved);
  if (existing) { if (resolved) existing.resolved = true; return; }
  p.aiMemory.knownBugs.push({ time: new Date().toISOString(), text, resolved });
  if (p.aiMemory.knownBugs.length > 40) p.aiMemory.knownBugs.shift();
}

/** Keyword retrieval: pick the project slices relevant to a query. */
export function retrieveContext(query: string): RetrievedContext {
  const p = store.project;
  const empty: RetrievedContext = { summary: 'No project open.', systems: [], keyObjects: [], relevantObjects: [], relevantScripts: [], recentDecisions: [], knownBugs: [], problems: [] };
  if (!p) return empty;
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter(w => w.length > 2);

  const relevantObjects: RetrievedContext['relevantObjects'] = [];
  for (const s of p.scenes) {
    for (const o of s.objects) {
      const text = (o.name + ' ' + o.tags.join(' ') + ' ' + o.components.map(c => c.type).join(' ')).toLowerCase();
      const score = words.reduce((a, w) => a + (text.includes(w) ? 1 : 0), 0);
      if (score >= 1 || o.components.some(c => ['ThirdPersonController', 'NPC', 'Spawner', 'DayNightCycle'].includes(c.type))) {
        relevantObjects.push({ name: o.name, components: o.components.map(c => c.type), tags: o.tags });
      }
    }
  }

  const relevantScripts = p.aiMemory.index.scripts
    .filter(s => words.some(w => s.keywords.includes(w)))
    .slice(0, 3)
    .map(s => ({ id: s.id, name: s.name, excerpt: (p.scripts[s.id]?.source ?? '').slice(0, 400) }));

  return {
    summary: p.aiMemory.summary || `"${p.name}"`,
    systems: p.aiMemory.systems,
    keyObjects: p.aiMemory.keyObjects.slice(0, 10),
    relevantObjects: relevantObjects.slice(0, 12),
    relevantScripts,
    recentDecisions: p.aiMemory.decisions.slice(-5).map(d => d.text),
    knownBugs: p.aiMemory.knownBugs.filter(b => !b.resolved).map(b => b.text),
    problems: store.problems.map(p => ({ file: p.file, line: p.line, message: p.message })),
  };
}

/** Compact prompt block for LLM mode. */
export function contextPrompt(ctx: RetrievedContext): string {
  return [
    `PROJECT: ${ctx.summary}`,
    `SYSTEMS: ${ctx.systems.join(', ') || 'none'}`,
    `KEY OBJECTS: ${ctx.keyObjects.map(o => `${o.name} (${o.role})`).join(', ') || 'none'}`,
    `RELEVANT OBJECTS: ${ctx.relevantObjects.map(o => `${o.name}[${o.components.join('|')}]`).join('; ') || 'none'}`,
    ctx.relevantScripts.length ? `RELEVANT SCRIPTS:\n${ctx.relevantScripts.map(s => `--- ${s.name}.js ---\n${s.excerpt}`).join('\n')}` : '',
    ctx.knownBugs.length ? `KNOWN BUGS: ${ctx.knownBugs.join(' | ')}` : '',
    ctx.problems.length ? `CURRENT PROBLEMS: ${ctx.problems.map(p => `${p.file}:${p.line} ${p.message}`).join(' | ')}` : 'No current problems.',
  ].filter(Boolean).join('\n');
}
