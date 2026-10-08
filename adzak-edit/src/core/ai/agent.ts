import type { AiCommand, AiExecutionResult, AiPlan, AiProvider } from '../types/ai';
import type { EditorApi } from './editorApi';
import { executePlan, type ExecutorContext } from './executor';
import { validateCommandBatch, describeErrors } from './validate';
import { getTool, toolManifestForPrompt } from './registry';
import { buildOfflinePlan } from './planner';
import { uid } from '../timeline/factory';
import { planRisk, type AiPermissionSettings, type ConsentSession } from './permissions';

/**
 * The editing agent.
 *
 * Pipeline: goal → plan → validate → consent → execute → report.
 *
 * The agent never edits anything itself. `createPlan()` only *proposes*
 * commands; `runPlan()` sends them through the same validation and consent path
 * as every other AI command, so an agent plan is no more privileged than a
 * single command the user typed.
 */

export interface AgentOptions {
  api: EditorApi;
  permissions: AiPermissionSettings;
  session: ConsentSession;
  /** null = no model configured; the offline planner is used. */
  provider: AiProvider | null;
  requestConsent: ExecutorContext['requestConsent'];
  onExecuted?: ExecutorContext['onExecuted'];
  onProgress?: (message: string) => void;
}

export interface PlanResult {
  plan: AiPlan;
  /** Where the plan came from — shown in the UI so the user is never misled. */
  source: 'local-model' | 'offline-rules';
}

const SYSTEM_PROMPT_HEADER = `You are the editing assistant inside ADZAK EDIT, a desktop video editor.
You do NOT edit anything directly. You propose a JSON array of commands.
The user sees every command and must approve changes before they happen.

Rules:
- Reply with ONLY a JSON array of command objects. No prose, no markdown fences.
- Every object needs an "action" and a short "reason".
- Use only the actions listed below, with exactly the arguments they accept.
- Never invent clip ids. Call get_timeline first and use the ids it returns.
- Times are seconds from the start of the timeline.
- Prefer the smallest number of commands that achieves the goal.
- If you cannot do something with these actions, return an empty array.

Available actions:
`;

export class EditingAgent {
  private readonly options: AgentOptions;

  constructor(options: AgentOptions) {
    this.options = options;
  }

  setProvider(provider: AiProvider | null): void {
    this.options.provider = provider;
  }

  /** Build a plan for a natural-language goal. Never throws. */
  async createPlan(goal: string): Promise<PlanResult> {
    const provider = this.options.provider;
    if (provider) {
      try {
        this.options.onProgress?.('Asking the local model for an editing plan…');
        const summary = this.options.api.getProjectSummary();
        const prompt = this.buildPrompt(goal, summary);
        const rawCommands = await provider.completeJson<unknown[]>(prompt, SYSTEM_PROMPT_HEADER + toolManifestForPrompt());

        if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
          // The model declined — fall back rather than showing an empty plan.
          this.options.onProgress?.('The model had no plan; using the built-in rules instead.');
          return this.offlinePlan(goal);
        }

        const validated = validateCommandBatch(rawCommands.slice(0, this.options.permissions.maxCommandsPerPlan));
        if (!validated.ok) {
          this.options.onProgress?.(
            `The model proposed an invalid command (${describeErrors(validated.errors).split('\n')[0]}). Using the built-in rules instead.`,
          );
          return this.offlinePlan(goal);
        }

        const plan: AiPlan = {
          id: uid('plan'),
          goal,
          summary: `${validated.commands.length} step${validated.commands.length === 1 ? '' : 's'} proposed by the local model.`,
          steps: validated.commands.map((command) => ({
            id: uid('step'),
            command,
            explanation: explainCommand(command),
            risk: riskOf(command),
          })),
          warnings: [],
          createdAt: Date.now(),
        };
        return { plan, source: 'local-model' };
      } catch (error) {
        this.options.onProgress?.(`Local model unavailable (${(error as Error).message}). Using the built-in rules.`);
        return this.offlinePlan(goal);
      }
    }
    return this.offlinePlan(goal);
  }

  private offlinePlan(goal: string): PlanResult {
    const built = buildOfflinePlan(goal, this.options.api);
    return { plan: built.plan, source: 'offline-rules' };
  }

  private buildPrompt(goal: string, summary: unknown): string {
    return [
      `USER GOAL: ${goal}`,
      '',
      'CURRENT PROJECT (read this before proposing anything):',
      JSON.stringify(summary, null, 2),
      '',
      'Return the JSON array of commands now.',
    ].join('\n');
  }

  /** Execute a plan the user has seen. */
  async runPlan(plan: AiPlan): Promise<{ results: AiExecutionResult[]; completed: number; risk: ReturnType<typeof planRisk> }> {
    const ctx: ExecutorContext = {
      api: this.options.api,
      permissions: this.options.permissions,
      session: this.options.session,
      requestConsent: this.options.requestConsent,
      onExecuted: this.options.onExecuted,
    };
    const commands = plan.steps.map((s) => s.command);
    const { results, completed } = await executePlan(commands, ctx);
    return { results, completed, risk: planRisk(plan.steps.map((s) => s.risk)) };
  }

  /** Plain-language description of one command, for the confirm dialog. */
  explain(command: AiCommand): string {
    return explainCommand(command);
  }
}

/* ------------------------------------------------------------------ *
 * Human-readable command descriptions
 * ------------------------------------------------------------------ */

export function explainCommand(command: AiCommand): string {
  const c = command as unknown as Record<string, unknown>;
  const n = (k: string, d = 2) => Number(c[k] ?? 0).toFixed(d);
  const s = (k: string) => String(c[k] ?? '');
  const reason = typeof c['reason'] === 'string' ? `\nWhy: ${c['reason']}` : '';

  switch (command.action) {
    case 'get_project':
      return `Read the project settings.${reason}`;
    case 'get_timeline':
      return `Read the timeline.${reason}`;
    case 'get_selected_clip':
      return `Read whatever is selected.${reason}`;
    case 'get_clip':
      return `Read clip ${s('clipId')}.${reason}`;
    case 'search_media':
      return `Search the media bin for "${s('query')}".${reason}`;
    case 'split_clip':
      return `Cut clip ${s('clipId')} into two at ${n('time')}s. The original file is untouched.${reason}`;
    case 'trim_clip':
      return `Move the ${s('edge')} point of ${s('clipId')} to ${n('time')}s.${reason}`;
    case 'move_clip':
      return `Move ${s('clipId')} to ${n('start')}s.${reason}`;
    case 'delete_clip':
      return `Delete ${s('clipId')}${c['ripple'] ? ' and close the gap' : ''}. Undo restores it.${reason}`;
    case 'add_text':
      return `Add the text "${s('text').slice(0, 40)}" at ${n('start')}s for ${n('duration')}s.${reason}`;
    case 'add_subtitle':
      return `Add a subtitle from ${n('start')}s to ${n('end')}s.${reason}`;
    case 'change_speed':
      return `Play ${s('clipId')} at ${n('speed', 1)}× speed${c['keepPitch'] ? ', keeping the pitch natural' : ''}.${reason}`;
    case 'reverse_clip':
      return `${c['reverse'] ? 'Reverse' : 'Un-reverse'} ${s('clipId')}.${reason}`;
    case 'crop_video':
      return `Crop ${s('clipId')}.${reason}`;
    case 'resize_video':
      return `Change the whole sequence to ${s('width')}×${s('height')}.${reason}`;
    case 'add_transition':
      return `Add a ${s('type')} transition (${n('duration')}s).${reason}`;
    case 'add_effect':
      return `Apply the "${s('effectId')}" effect to ${s('clipId')}.${reason}`;
    case 'set_volume':
      return `Set ${s('clipId')} to ${n('volumeDb', 1)} dB.${reason}`;
    case 'set_keyframe':
      return `Keyframe ${s('property')} on ${s('clipId')} at ${n('time')}s.${reason}`;
    case 'remove_silence':
      return c['dryRun']
        ? `Analyse ${s('clipId')} for silence — nothing will be deleted yet.${reason}`
        : `Remove the silent sections from ${s('clipId')}.${reason}`;
    case 'transcribe_clip':
      return `Run local speech recognition on ${s('clipId')}.${reason}`;
    case 'create_sequence':
      return `Create a new ${s('width')}×${s('height')} sequence called "${s('name')}".${reason}`;
    case 'export_video':
      return `Prepare a "${s('preset')}" export. You still confirm the final dialog.${reason}`;
    default:
      // Exhaustive switch: unreachable unless a new action is added without a
      // description here. Degrade to the raw name rather than throwing.
      return `Run ${(command as { action: string }).action}.${reason}`;
  }
}

function riskOf(command: AiCommand): AiPlan['steps'][number]['risk'] {
  return getTool(command.action)?.risk ?? 'moderate';
}
