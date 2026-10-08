import type { AiCommand, AiExecutionResult } from '../types/ai';
import type { EditorApi } from './editorApi';
import { dbToGain } from './editorApi';
import { getTool } from './registry';
import { validateCommand, describeErrors } from './validate';
import { decideConsent, type AiPermissionSettings, type ConsentSession } from './permissions';

/**
 * Command executor — the third and final layer.
 *
 *   model output → validate → consent → EditorApi → editor state
 *
 * Every command is re-validated here even if the caller already validated it,
 * because the executor is the last thing standing between a model and the
 * user's project. Defence in depth is the point.
 */

export interface ExecutorContext {
  api: EditorApi;
  permissions: AiPermissionSettings;
  session: ConsentSession;
  /** Ask the user. Resolve true to allow. Must never throw. */
  requestConsent: (command: AiCommand, summary: string) => Promise<boolean>;
  /** Called for every executed command so the UI can log the agent's actions. */
  onExecuted?: (result: AiExecutionResult) => void;
}

export async function executeCommand(command: unknown, ctx: ExecutorContext): Promise<AiExecutionResult> {
  const asCommand = command as AiCommand;

  // 1. Validate.
  const validation = validateCommand(command);
  if (!validation.ok || !validation.normalized) {
    const result: AiExecutionResult = {
      command: asCommand,
      ok: false,
      error: `Command rejected: ${describeErrors(validation.errors)}`,
    };
    ctx.onExecuted?.(result);
    return result;
  }
  const cmd = validation.normalized;
  const tool = getTool(cmd.action)!;

  // 2. Consent.
  const decision = decideConsent(cmd, ctx.permissions, ctx.session);
  if (decision.blocked) {
    const result: AiExecutionResult = { command: cmd, ok: false, error: decision.reason, declined: true };
    ctx.onExecuted?.(result);
    return result;
  }
  if (!decision.autoApprove) {
    const summary = tool.humanTitle(cmd as unknown as Record<string, unknown>);
    const allowed = await ctx.requestConsent(cmd, `${summary}\n\n${decision.reason}`);
    if (!allowed) {
      const result: AiExecutionResult = { command: cmd, ok: false, error: 'You cancelled this change.', declined: true };
      ctx.onExecuted?.(result);
      return result;
    }
    if (decision.policy === 'confirm-once') ctx.session.grant(tool.name);
  }

  // 3. Execute through the editor API only.
  try {
    const result = await dispatch(cmd, ctx.api);
    ctx.onExecuted?.(result);
    return result;
  } catch (error) {
    const result: AiExecutionResult = {
      command: cmd,
      ok: false,
      error: humaniseError(error),
    };
    ctx.onExecuted?.(result);
    return result;
  }
}

/** Run a whole plan, stopping at the first failure so half-applied plans cannot happen silently. */
export async function executePlan(
  commands: AiCommand[],
  ctx: ExecutorContext,
  options: { stopOnFirstError?: boolean } = {},
): Promise<{ results: AiExecutionResult[]; completed: number }> {
  const results: AiExecutionResult[] = [];
  let completed = 0;
  for (const command of commands) {
    const result = await executeCommand(command, ctx);
    results.push(result);
    if (result.ok) {
      completed++;
      continue;
    }
    // A user cancelling is not a crash, but it does mean the rest of the plan
    // is probably no longer what they wanted.
    if (options.stopOnFirstError !== false) break;
  }
  return { results, completed };
}

async function dispatch(command: AiCommand, api: EditorApi): Promise<AiExecutionResult> {
  const c = command as unknown as Record<string, unknown>;
  const str = (k: string) => String(c[k] ?? '');
  const num = (k: string) => Number(c[k] ?? 0);
  const bool = (k: string) => Boolean(c[k]);
  const optStr = (k: string): string | undefined => (c[k] === undefined ? undefined : String(c[k]));

  switch (command.action) {
    case 'get_project':
      return ok(command, api.getProjectSummary());
    case 'get_timeline':
      return ok(command, api.getTimelineSnapshot());
    case 'get_selected_clip': {
      const ids = api.getSelectedClipIds();
      if (!ids.length) return fail(command, 'Nothing is selected on the timeline.');
      const clips = ids.map((id) => api.getClip(id)).filter(Boolean);
      return ok(command, clips);
    }
    case 'get_clip': {
      const clip = api.getClip(str('clipId'));
      return clip ? ok(command, clip) : fail(command, `There is no clip "${str('clipId')}" on the timeline.`);
    }
    case 'search_media': {
      const hits = api.searchMedia(str('query'));
      return ok(command, hits);
    }
    case 'split_clip':
      return from(command, api.splitClip(str('clipId'), num('time')));
    case 'trim_clip':
      return from(command, api.trimClip(str('clipId'), str('edge') === 'out' ? 'out' : 'in', num('time')));
    case 'move_clip':
      return from(command, api.moveClip(str('clipId'), num('start'), optStr('trackId')));
    case 'delete_clip':
      return from(command, api.deleteClip(str('clipId'), bool('ripple')));
    case 'add_text':
      return from(command, api.addText(str('text'), num('start'), num('duration'), optStr('trackId')));
    case 'add_subtitle':
      return from(command, api.addSubtitle(str('text'), num('start'), num('end'), optStr('trackId')));
    case 'change_speed':
      return from(command, api.changeSpeed(str('clipId'), num('speed'), bool('keepPitch')));
    case 'reverse_clip':
      return from(command, api.reverseClip(str('clipId'), bool('reverse')));
    case 'crop_video':
      return from(
        command,
        api.cropClip(str('clipId'), {
          top: num('top'),
          right: num('right'),
          bottom: num('bottom'),
          left: num('left'),
        }),
      );
    case 'resize_video':
      return from(command, api.resizeSequence(num('width'), num('height')));
    case 'add_transition':
      return from(command, api.addTransition(str('leftClipId'), str('rightClipId'), str('type'), num('duration')));
    case 'add_effect':
      return from(
        command,
        api.addEffect(
          str('clipId'),
          str('effectId'),
          (c['params'] as Record<string, number | boolean | string> | undefined) ?? undefined,
        ),
      );
    case 'set_volume': {
      // The model speaks dB; the clip stores linear gain.
      const db = num('volumeDb');
      const outcome = api.setVolume(str('clipId'), db);
      if (outcome.ok) {
        return ok(command, { clipId: str('clipId'), volumeDb: db, linearGain: Number(dbToGain(db).toFixed(4)) });
      }
      return from(command, outcome);
    }
    case 'set_keyframe': {
      const value = c['value'];
      const numeric = Array.isArray(value) ? (value as number[]) : num('value');
      return from(command, api.setKeyframe(str('clipId'), str('property'), num('time'), numeric));
    }
    case 'remove_silence': {
      const outcome = await api.removeSilence(str('clipId'), num('thresholdDb'), num('minSilenceSec'), bool('dryRun'));
      return outcome.ok ? ok(command, outcome) : fail(command, outcome.error ?? 'Silence detection failed.');
    }
    case 'transcribe_clip': {
      const outcome = await api.transcribeClip(str('clipId'), optStr('language'));
      if (outcome.needsModel) {
        return fail(
          command,
          'Speech recognition needs a local Whisper model that is not installed yet. Open Settings → AI Models to download one (about 150 MB). No internet is needed afterwards.',
        );
      }
      return outcome.ok ? ok(command, { cues: outcome.cues?.length ?? 0, language: outcome.language }) : fail(command, outcome.error ?? 'Transcription failed.');
    }
    case 'create_sequence':
      return from(command, api.createSequence(str('name'), num('width'), num('height'), num('fps')));
    case 'export_video':
      return from(command, api.queueExport(str('preset'), optStr('path')));
    default:
      // Unreachable: validateCommand already rejected unknown actions.
      return fail(command, `Unhandled command "${(command as { action: string }).action}".`);
  }
}

function ok(command: AiCommand, data: unknown): AiExecutionResult {
  return { command, ok: true, data };
}

function fail(command: AiCommand, error: string): AiExecutionResult {
  return { command, ok: false, error };
}

function from(
  command: AiCommand,
  outcome: { ok: boolean; error?: string; ids?: string[]; data?: unknown },
): AiExecutionResult {
  if (outcome.ok) return { command, ok: true, data: outcome.data ?? { ids: outcome.ids ?? [] } };
  return { command, ok: false, error: outcome.error ?? 'The editor refused this change.' };
}

/**
 * Turn internal errors into sentences a user can act on.
 * The spec is explicit: never show "FFmpeg exited with code 1".
 */
export function humaniseError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (/ENOENT/i.test(msg)) return 'A file the editor needed could not be found. It may have been moved or deleted.';
    if (/EACCES|EPERM/i.test(msg)) return 'The operating system refused access to that file. Check its permissions.';
    if (/ENOSPC/i.test(msg)) return 'Your disk is full. Free up space and try again.';
    return msg;
  }
  return String(error);
}
