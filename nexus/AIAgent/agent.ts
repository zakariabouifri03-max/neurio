// ============================================================================
// NEXUS AI AGENT — Orchestrator
// Two modes:
//   • Offline (default): deterministic planner → structured tool calls
//   • LLM (optional): connected model drives the SAME tools via function
//     calling; the server proxies requests (key stays server-side)
// Both modes share tools, memory, the debugger and the safety review flow.
// ============================================================================

import { store } from '../Editor/store';
import { getTool, type ToolResult, setEditorContext, type EditorContext } from './tools';
import { planFromText, type Plan, type PlanContext } from './planner';
import { retrieveContext, contextPrompt, refreshMemory, rememberDecision } from './memory';
import { diagnoseGameplayBug, diagnoseProblem, type Diagnosis } from './debugger';
import { callLlm, llmToolLoop } from './llm';
import { editorBus } from '../Engine/core/events';

export type AgentEvent =
  | { type: 'message'; role: 'agent'; html: string }
  | { type: 'message'; role: 'user'; text: string }
  | { type: 'tool'; name: string; args: any; result: ToolResult | string }
  | { type: 'plan'; title: string; intro: string; steps: { id: string; label: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'failed' }[] }
  | { type: 'plan-step'; id: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; note?: string }
  | { type: 'review'; manifest: { summary: string; changes: string[] }; resolve: (apply: boolean) => void }
  | { type: 'diagnosis'; diagnosis: Diagnosis }
  | { type: 'busy'; busy: boolean };

export class Agent {
  private emit: (e: AgentEvent) => void;
  busy = false;

  constructor(emit: (e: AgentEvent) => void) {
    this.emit = emit;
  }

  private toolRunner = (tool: string, args: any): ToolResult => {
    const t = getTool(tool);
    if (!t) return { ok: false, summary: `Unknown tool: ${tool}` };
    try {
      const r = t.execute(args ?? {});
      this.emit({ type: 'tool', name: tool, args, result: r });
      if (r.changes?.length && !r.summary.includes('pending')) editorBus.emit('objectsChanged', { ids: [] });
      return r;
    } catch (e: any) {
      const r = { ok: false, summary: `Tool error: ${e?.message ?? e}` };
      this.emit({ type: 'tool', name: tool, args, result: r });
      return r;
    }
  };

  async chat(text: string) {
    if (this.busy) return;
    this.emit({ type: 'message', role: 'user', text });
    if (!store.project) {
      this.emit({ type: 'message', role: 'agent', html: 'Open or create a project first — I can only work inside a project. Use <b>File ▸ New Project</b> or <b>File ▸ Create With AI</b>.' });
      return;
    }
    this.busy = true;
    this.emit({ type: 'busy', busy: true });
    try {
      if (store.aiMode === 'llm' && store.llmConfigured) {
        await this.runLlm(text);
      } else {
        await this.runOffline(text);
      }
    } finally {
      this.busy = false;
      this.emit({ type: 'busy', busy: false });
    }
  }

  // ------------------------------ offline mode -------------------------------

  private async runOffline(text: string) {
    const match = planFromText(text);
    switch (match.intent) {
      case 'debug': await this.handleDebug(text); return;
      case 'build': {
        this.emit({ type: 'message', role: 'agent', html: 'Starting a <b>Release build</b> — watch the Output panel for the pipeline log.' });
        const ctx = (agentEditorCtx as any);
        const r = await ctx?.buildProject?.('Release');
        this.emit({ type: 'message', role: 'agent', html: r?.ok ? 'Build finished. Open the Build folder to run your game.' : 'Build failed — see Output for the cause (you can ask me to fix errors).' });
        return;
      }
      case 'unknown': {
        const examples = [
          'Create a third-person player', 'Add a zombie enemy', 'Make zombies spawn at night',
          'Create a realistic survival island with forests and a village', 'Add a health bar and inventory UI',
          'The player cannot jump',
        ];
        this.emit({
          type: 'message', role: 'agent',
          html: `I couldn't map that to an action with the <b>offline planner</b>. Try one of these, or connect an LLM in <b>AI ▸ AI Settings</b> for open-ended requests:<ul>${examples.map(e => `<li>“${e}”</li>`).join('')}</ul>`,
        });
        return;
      }
      default: {
        if (!match.plan?.steps.length) {
          this.emit({ type: 'message', role: 'agent', html: 'Nothing to do for that request.' });
          return;
        }
        await this.executePlan(match.plan, text);
      }
    }
  }

  async executePlan(plan: Plan, sourceText: string) {
    const steps = plan.steps;
    this.emit({ type: 'plan', title: plan.title, intro: plan.intro, steps: steps.map(s => ({ id: s.id, label: s.label, status: 'pending' as const })) });
    this.emit({ type: 'message', role: 'agent', html: `<b>${plan.title}</b><br>${plan.intro}` });

    // safety review for destructive or large plans
    const destructive = steps.some(s => /delete|remove|modify_script/i.test(s.id));
    if (destructive || steps.length >= 8) {
      const approved = await this.requestReview({
        summary: `${plan.title} — ${steps.length} steps${destructive ? ', includes modifications to existing content' : ''}`,
        changes: steps.map(s => `• ${s.label}`),
      });
      if (!approved) {
        this.emit({ type: 'message', role: 'agent', html: 'Plan cancelled — nothing was changed.' });
        return;
      }
    }

    store.pushUndo(`AI: ${plan.title}`);
    const ctx: PlanContext = { results: {}, vars: {} };
    // pre-scan for existing spawners (used by night-spawn recipe)
    const spawnerObj = store.scene?.objects.find(o => o.components.some(c => c.type === 'Spawner'));
    if (spawnerObj) ctx.vars.existingSpawner = spawnerObj.name;

    let okCount = 0, failCount = 0;
    for (const step of steps) {
      this.emit({ type: 'plan-step', id: step.id, status: 'running' });
      try {
        const r = await step.run(ctx);
        const summary = typeof r === 'string' ? r : r.summary;
        const failed = typeof r !== 'string' && r.ok === false;
        if (failed) {
          failCount++;
          this.emit({ type: 'plan-step', id: step.id, status: 'failed', note: summary });
        } else if (summary.startsWith('skipped') || summary.includes('skipped') || summary.startsWith('No enemy exists')) {
          this.emit({ type: 'plan-step', id: step.id, status: 'skipped', note: summary });
        } else {
          okCount++;
          this.emit({ type: 'plan-step', id: step.id, status: 'done', note: summary });
        }
        if (typeof r !== 'string' && r.details) ctx.results[step.id] = r.details;
      } catch (e: any) {
        failCount++;
        this.emit({ type: 'plan-step', id: step.id, status: 'failed', note: e?.message ?? String(e) });
      }
    }
    rememberDecision(`AI plan executed: ${plan.title} (${sourceText.slice(0, 80)})`);
    refreshMemory('plan');
    store.markDirty();
    this.emit({
      type: 'message', role: 'agent',
      html: `✅ <b>Plan complete</b> — ${okCount} step(s) succeeded${failCount ? `, ${failCount} failed` : ''}. Press <b>▶ Play</b> to try it, or ask me for the next thing. ${failCount ? 'Failed steps are marked red in the plan above.' : ''}`,
    });
  }

  private requestReview(manifest: { summary: string; changes: string[] }): Promise<boolean> {
    return new Promise(resolve => {
      this.emit({ type: 'review', manifest, resolve });
    });
  }

  // ------------------------------ debug flow ---------------------------------

  async handleDebug(text: string) {
    this.emit({ type: 'message', role: 'agent', html: '🔍 <b>AI Debugger</b> — analyzing the project…' });

    // 1) console problems first
    const problems = store.problems.filter(p => p.severity === 'error');
    const diagnoses: Diagnosis[] = [];
    if (problems.length) {
      this.emit({ type: 'message', role: 'agent', html: `Found <b>${problems.length} error(s)</b>. Diagnosing…` });
      for (const p of problems.slice(0, 4)) {
        const d = diagnoseProblem(p);
        if (d) { diagnoses.push(d); this.emit({ type: 'diagnosis', diagnosis: d }); }
      }
    }
    // 2) gameplay bug report diagnostics
    const gameplay = diagnoseGameplayBug(text);
    for (const d of gameplay) { diagnoses.push(d); this.emit({ type: 'diagnosis', diagnosis: d }); }

    if (!diagnoses.length) {
      this.emit({ type: 'message', role: 'agent', html: 'No errors captured yet. Run the game (▶ Play), reproduce the issue, then ask me again — or describe the symptom like <i>“the player cannot jump”</i>.' });
      return;
    }

    // apply the first actionable fix automatically is NOT done — the UI shows
    // [Apply Fix] / [Cancel]; agent waits via applyDiagnosis()
  }

  async applyDiagnosis(d: Diagnosis): Promise<void> {
    store.pushUndo(`AI fix: ${d.title}`);
    const r = d.apply();
    const summary = typeof r === 'string' ? r : r.summary;
    this.emit({ type: 'tool', name: 'apply_fix', args: { title: d.title }, result: { ok: typeof r === 'string' ? false : r.ok, summary } });
    this.emit({ type: 'message', role: 'agent', html: `🛠️ Applied fix: <b>${d.title}</b><br>${typeof r === 'string' ? r : r.summary}` });
    rememberDecision(`AI fix applied: ${d.title}`);
    refreshMemory('fix');
    if (d.testPlan) {
      this.emit({ type: 'message', role: 'agent', html: '🧪 Running automated test…' });
      const ctx = agentEditorCtx;
      if (ctx) {
        const report = await ctx.runPlaytest(d.testPlan.seconds);
        if (report?.passed) this.emit({ type: 'message', role: 'agent', html: `✅ <b>Test passed</b> — ${report.framesSimulated} frames simulated, no errors${report.failures?.length ? '' : ', all assertions OK'}.` });
        else this.emit({ type: 'message', role: 'agent', html: `⚠️ <b>Test found issues</b>:<pre>${[...(report?.errors ?? []), ...(report?.failures ?? [])].join('\n')}</pre>Want me to keep debugging?` });
      }
    }
  }

  // -------------------------------- LLM mode ---------------------------------

  private async runLlm(text: string) {
    const ctx = retrieveContext(text);
    const system = `You are the NEXUS GAME STUDIO AI Agent — a professional game development assistant embedded in a 3D game engine editor.
You modify the user's project ONLY by calling the provided tools. Always prefer tools over giving manual instructions.
Available components: ThirdPersonController, FirstPersonController, TopDownController, NPC (states: idle/patrol/investigate/follow/chase/attack/flee/dead), Health, DamageDealer, Pickup, Inventory, Interactable, TriggerVolume, Door, Spawner, Weapon, Projectile, DayNightCycle, Terrain, Water, Light, Camera, AudioSource, Animator, CharacterBody (procedural humanoid), Collider, RigidBody, Script, SaveSystem, GameRules.
Project context:
${contextPrompt(ctx)}

Rules:
- Call tools to make changes. After changes, briefly summarize what you did.
- For destructive actions (delete_game_object, modify_script) call them only when clearly asked.
- Scripts must be a JS class extending Nexus.Component with hooks onStart/onUpdate(dt)/onDestroy/onTriggerEnter(other)/onInteract(player). API: this.gameObject (position, setPosition, move, rotateY, destroy, find), Nexus.find/findByTag/spawn/on/emit/log/save/load.
- Keep answers compact and actionable.`;
    try {
      const finalMessage = await llmToolLoop(text, system, (tool, args) => this.toolRunner(tool, args), (delta) => {
        // streaming not required — handled in llm.ts
      });
      this.emit({ type: 'message', role: 'agent', html: finalMessage || '(done)' });
      refreshMemory('llm');
      rememberDecision(`LLM request: ${text.slice(0, 80)}`);
      store.markDirty();
    } catch (e: any) {
      this.emit({ type: 'message', role: 'agent', html: `⚠️ LLM request failed: ${e?.message ?? e}. Falling back to the offline planner.` });
      await this.runOffline(text);
    }
  }
}

let agentEditorCtx: EditorContext | null = null;
export function initAgent(ctx: EditorContext) {
  setEditorContext(ctx);
  agentEditorCtx = ctx;
}

export const agentToolsManifest = () => {
  // imported lazily to avoid cycles
  return import('./tools').then(m => m.allTools().map(t => ({
    name: t.name,
    description: t.description,
    params: t.params,
    destructive: !!t.destructive,
  })));
};
