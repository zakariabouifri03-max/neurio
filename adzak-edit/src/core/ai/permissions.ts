import type { AiCommand, AiToolDefinition, ConsentPolicy, RiskLevel } from '../types/ai';
import { getTool } from './registry';

/**
 * Consent policy — the first layer of the trust boundary.
 *
 * Rules, in order of strength:
 *   1. If global AI editing is off, nothing mutates. Period.
 *   2. Destructive commands always ask, unless the user explicitly enabled
 *      "auto-apply destructive" (off by default, buried in Settings → AI).
 *   3. Per-tool overrides let a user say "always allow split_clip" after they
 *      have watched it behave.
 *   4. `confirm-once` tools are remembered for the session after the first yes.
 */

export interface AiPermissionSettings {
  /** Master switch for the AI editing agent. */
  aiEditingEnabled: boolean;
  /** Allow destructive commands without a prompt. Off by default. */
  autoApplyDestructive: boolean;
  /** Per-tool policy overrides keyed by tool name. */
  overrides: Record<string, ConsentPolicy>;
  /** Tools the user has permanently blocked. */
  blocked: string[];
  /** Never let the AI run more than this many commands in one plan. */
  maxCommandsPerPlan: number;
}

export const DEFAULT_PERMISSIONS: AiPermissionSettings = {
  aiEditingEnabled: true,
  autoApplyDestructive: false,
  overrides: {},
  blocked: [],
  maxCommandsPerPlan: 24,
};

/** Grants remembered for the current editing session (cleared on app restart). */
export class ConsentSession {
  private readonly granted = new Set<string>();
  private autoApproveReads = true;

  grant(toolName: string): void {
    this.granted.add(toolName);
  }

  revoke(toolName: string): void {
    this.granted.delete(toolName);
  }

  has(toolName: string): boolean {
    return this.granted.has(toolName);
  }

  /** "Don't ask again for read-only tools" toggle. */
  setAutoApproveReads(value: boolean): void {
    this.autoApproveReads = value;
  }

  get readsAutoApproved(): boolean {
    return this.autoApproveReads;
  }

  clear(): void {
    this.granted.clear();
  }
}

export interface ConsentDecision {
  /** True when the command may run without showing a dialog. */
  autoApprove: boolean;
  /** Human readable reason shown next to the prompt. */
  reason: string;
  /** Hard block — the command must not run at all. */
  blocked: boolean;
  policy: ConsentPolicy;
}

export function resolvePolicy(tool: AiToolDefinition, settings: AiPermissionSettings): ConsentPolicy {
  return settings.overrides[tool.name] ?? tool.defaultPolicy;
}

export function decideConsent(
  command: AiCommand,
  settings: AiPermissionSettings,
  session: ConsentSession,
): ConsentDecision {
  const tool = getTool(command.action);
  if (!tool) {
    return {
      autoApprove: false,
      blocked: true,
      policy: 'confirm-always',
      reason: `"${command.action}" is not a known editor command.`,
    };
  }

  if (settings.blocked.includes(tool.name)) {
    return { autoApprove: false, blocked: true, policy: 'confirm-always', reason: `You have blocked "${tool.name}".` };
  }

  if (!tool.readOnly && !settings.aiEditingEnabled) {
    return {
      autoApprove: false,
      blocked: true,
      policy: 'confirm-always',
      reason: 'AI editing is turned off in Settings → AI. Read-only tools still work.',
    };
  }

  const policy = resolvePolicy(tool, settings);

  if (tool.readOnly) {
    return { autoApprove: session.readsAutoApproved || policy === 'auto', blocked: false, policy, reason: 'Read-only.' };
  }
  if (policy === 'auto') {
    return { autoApprove: true, blocked: false, policy, reason: 'You allowed this tool to run automatically.' };
  }
  if (tool.risk === 'destructive' && !settings.autoApplyDestructive) {
    return {
      autoApprove: false,
      blocked: false,
      policy: 'confirm-always',
      reason: 'This change removes material from your timeline. Destructive commands always ask.',
    };
  }
  if (policy === 'confirm-once' && session.has(tool.name)) {
    return { autoApprove: true, blocked: false, policy, reason: 'You allowed this earlier in the session.' };
  }
  return { autoApprove: false, blocked: false, policy, reason: riskReason(tool.risk) };
}

function riskReason(risk: RiskLevel): string {
  switch (risk) {
    case 'safe':
      return 'This is a safe, fully undoable change.';
    case 'moderate':
      return 'This changes your timeline. Undo (Ctrl+Z) restores it.';
    case 'destructive':
      return 'This removes material from your timeline.';
    default:
      return '';
  }
}

/** Aggregate risk of a whole plan, for the plan-level banner. */
export function planRisk(risks: RiskLevel[]): RiskLevel {
  if (risks.includes('destructive')) return 'destructive';
  if (risks.includes('moderate')) return 'moderate';
  return 'safe';
}

/**
 * Count how many commands in a plan need a prompt. Used to decide between
 * "show one dialog for the plan" and "show a dialog per step".
 */
export function countPrompts(
  commands: AiCommand[],
  settings: AiPermissionSettings,
  session: ConsentSession,
): number {
  return commands.filter((c) => !decideConsent(c, settings, session).autoApprove).length;
}
