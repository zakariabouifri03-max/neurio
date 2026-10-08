/**
 * AI command contract.
 *
 * THE INVARIANT: the model never touches application state. It emits a JSON
 * command that matches one of the schemas below; `core/ai/validate.ts` checks
 * it; `core/ai/permissions.ts` checks the user's consent policy; only then does
 * `core/ai/executor.ts` apply it through the same timeline operations the UI
 * uses (so every AI edit is undoable and validated identically).
 */

export type RiskLevel = 'safe' | 'moderate' | 'destructive';

/** Consent required before an executor may run a command of this risk. */
export type ConsentPolicy = 'auto' | 'confirm-once' | 'confirm-always';

export interface AiToolSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  items?: AiToolSchemaProperty;
  properties?: Record<string, AiToolSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  /** Extra guard beyond JSON-schema typing; receives the raw value. */
  validate?: (value: unknown) => string | null;
}

export interface AiToolSchema {
  type: 'object';
  properties: Record<string, AiToolSchemaProperty>;
  required?: string[];
  /** Reject unknown keys: prevents prompt-injected payloads from smuggling data. */
  additionalProperties?: boolean;
  /**
   * Cross-field guard run after per-property validation. Return a message to
   * reject, or null to accept. Used where the constraint involves several
   * arguments at once (e.g. a crop that must leave visible area).
   */
  validate?: (args: Record<string, unknown>) => string | null;
}

export interface AiToolDefinition {
  /** Wire name the LLM must emit, e.g. "split_clip". */
  name: string;
  /** Human readable summary shown in the AI panel *before* execution. */
  humanTitle(args: Record<string, unknown>): string;
  description: string;
  risk: RiskLevel;
  /** Default policy; users can raise it in Settings → AI. */
  defaultPolicy: ConsentPolicy;
  schema: AiToolSchema;
  /** True for tools that only read state (get_project, search_media, …). */
  readOnly: boolean;
  /** Whether the tool can be batched inside a plan without per-step confirm. */
  batchable: boolean;
}

/* ------------------------------------------------------------------ *
 * The command union. Discriminated on `action`; every action must have
 * a matching AiToolDefinition in core/ai/registry.ts.
 * ------------------------------------------------------------------ */

export interface AiCommandBase {
  action: string;
  /** Free-form rationale the model must supply; surfaced in the confirm dialog. */
  reason?: string;
}

export type AiCommand =
  | { action: 'get_project' }
  | { action: 'get_timeline' }
  | { action: 'get_selected_clip' }
  | { action: 'get_clip'; clipId: string }
  | { action: 'search_media'; query: string }
  | { action: 'transcribe_clip'; clipId: string; language?: string }
  | { action: 'split_clip'; clipId: string; time: number }
  | { action: 'trim_clip'; clipId: string; edge: 'in' | 'out'; time: number }
  | { action: 'move_clip'; clipId: string; trackId?: string; start: number }
  | { action: 'delete_clip'; clipId: string; ripple: boolean }
  | { action: 'add_text'; text: string; start: number; duration: number; trackId?: string }
  | { action: 'add_subtitle'; text: string; start: number; end: number; trackId?: string }
  | { action: 'change_speed'; clipId: string; speed: number; keepPitch: boolean }
  | { action: 'reverse_clip'; clipId: string; reverse: boolean }
  | { action: 'crop_video'; clipId: string; top: number; right: number; bottom: number; left: number }
  | { action: 'resize_video'; width: number; height: number }
  | { action: 'add_transition'; leftClipId: string; rightClipId: string; type: string; duration: number }
  | { action: 'add_effect'; clipId: string; effectId: string; params?: Record<string, number | boolean | string> }
  | { action: 'set_volume'; clipId: string; volumeDb: number }
  | { action: 'set_keyframe'; clipId: string; property: string; time: number; value: number | number[] }
  | { action: 'remove_silence'; clipId: string; thresholdDb: number; minSilenceSec: number; dryRun: boolean }
  | { action: 'create_sequence'; name: string; width: number; height: number; fps: number }
  | { action: 'export_video'; preset: string; path?: string };

export type AiActionName = AiCommand['action'];

export interface ValidationError {
  path: string;
  message: string;
  code: 'missing' | 'type' | 'range' | 'enum' | 'unknown' | 'custom';
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** The command with defaults filled in, when ok. */
  normalized?: AiCommand;
}

export interface ConsentRequest {
  command: AiCommand;
  tool: AiToolDefinition;
  /** Human readable diff/summary the user approves. */
  summary: string;
}

/** A plan is an ordered, explainable list of commands the agent proposes. */
export interface AiPlanStep {
  id: string;
  command: AiCommand;
  explanation: string;
  risk: RiskLevel;
}

export interface AiPlan {
  id: string;
  goal: string;
  summary: string;
  steps: AiPlanStep[];
  /** Set when the agent refuses because it lacks a capability or permission. */
  warnings: string[];
  createdAt: number;
}

export interface AiExecutionResult {
  command: AiCommand;
  ok: boolean;
  /** Value returned to the model for read-only tools. */
  data?: unknown;
  error?: string;
  /** True when the user declined the consent prompt. */
  declined?: boolean;
}

/** Provider abstraction — Ollama, llama.cpp server, or the offline heuristic
 *  fallback. Swapping providers never touches the command layer. */
export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresInternet: boolean;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<AiModelInfo[]>;
  /** Must return strictly valid JSON; implementations repair/extract it. */
  completeJson<T>(prompt: string, schemaHint: string): Promise<T>;
}

export interface AiModelInfo {
  id: string;
  sizeBytes?: number;
  contextLength?: number;
  capabilities?: string[];
}
