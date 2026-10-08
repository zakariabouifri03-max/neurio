import type { AiCommand, AiToolDefinition, ValidationError, ValidationResult } from '../types/ai';
import { coerceToSchema, validateAgainstSchema } from './schema';
import { getTool } from './registry';

/**
 * Command validation — the second layer of the trust boundary.
 *
 * Layer 1 (`permissions.ts`) decides whether the *user* is willing.
 * Layer 2 (this file) decides whether the *command itself* is well-formed and
 * known. A command that fails here never reaches the editor engine.
 */

export class UnknownCommandError extends Error {
  constructor(readonly action: string) {
    super(
      `The AI tried to run "${action}", which is not in the allowed command list. ` +
        `This is blocked by design — the model can only use the built-in tools.`,
    );
    this.name = 'UnknownCommandError';
  }
}

export function validateCommand(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail([{ path: '', code: 'type', message: 'A command must be a JSON object with an "action" field.' }]);
  }
  const obj = raw as Record<string, unknown>;
  const action = obj['action'];

  if (typeof action !== 'string' || !action.trim()) {
    return fail([{ path: 'action', code: 'missing', message: 'Every command needs an "action" field.' }]);
  }

  const tool = getTool(action.trim());
  if (!tool) {
    return fail([
      {
        path: 'action',
        code: 'enum',
        message: `"${action}" is not a supported command. The AI is restricted to the built-in editor tools.`,
      },
    ]);
  }

  // `action` selects the tool and `reason` is how the model explains itself.
  // Both are accepted on any command and must be stripped before schema
  // validation, or `additionalProperties: false` rejects every single command.
  const { reason, action: _action, ...rest } = obj;
  const coerced = coerceToSchema(rest, tool.schema);
  const errors = validateAgainstSchema(coerced, tool.schema);
  if (errors.length) return fail(errors);

  const normalized = { action: tool.name, ...(typeof reason === 'string' ? { reason } : {}), ...coerced } as AiCommand;
  const semantic = validateSemantics(normalized, tool);
  if (semantic.length) return fail(semantic);

  return { ok: true, errors: [], normalized };
}

/**
 * Rules that need more than the declared schema: relationships between values
 * that the tool author knows about but JSON-schema cannot express.
 */
function validateSemantics(command: AiCommand, _tool: AiToolDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const c = command as unknown as Record<string, unknown>;

  switch (command.action) {
    case 'trim_clip': {
      const time = Number(c['time']);
      if (!Number.isFinite(time) || time < 0) {
        errors.push({ path: 'time', code: 'range', message: 'Trim time must be a non-negative number.' });
      }
      break;
    }
    case 'add_subtitle': {
      const start = Number(c['start']);
      const end = Number(c['end']);
      if (end <= start) {
        errors.push({ path: 'end', code: 'range', message: 'The subtitle must end after it starts.' });
      }
      if (end - start > 30) {
        errors.push({ path: 'end', code: 'range', message: 'A single subtitle longer than 30 s is not allowed; split it.' });
      }
      break;
    }
    case 'change_speed': {
      const speed = Number(c['speed']);
      if (speed <= 0) errors.push({ path: 'speed', code: 'range', message: 'Speed must be greater than zero.' });
      break;
    }
    case 'resize_video':
    case 'create_sequence': {
      const w = Number(c['width']);
      const h = Number(c['height']);
      const megapixels = (w * h) / 1_000_000;
      if (megapixels > 34) {
        errors.push({
          path: 'width',
          code: 'range',
          message: `${w}×${h} is ${megapixels.toFixed(1)} MP. The maximum supported frame is 34 MP (8K).`,
        });
      }
      if (w % 2 !== 0 || h % 2 !== 0) {
        errors.push({ path: 'width', code: 'range', message: 'Width and height must both be even numbers.' });
      }
      break;
    }
    case 'set_volume': {
      const db = Number(c['volumeDb']);
      if (db > 6) {
        errors.push({ path: 'volumeDb', code: 'range', message: 'Boosting above +6 dB will clip; use the loudness normaliser instead.' });
      }
      break;
    }
    case 'remove_silence': {
      const min = Number(c['minSilenceSec']);
      if (min < 0.15) {
        errors.push({ path: 'minSilenceSec', code: 'range', message: 'A minimum silence below 0.15 s will cut into speech.' });
      }
      break;
    }
    case 'add_text': {
      const text = String(c['text'] ?? '');
      if (!text.trim()) errors.push({ path: 'text', code: 'custom', message: 'Text cannot be empty.' });
      break;
    }
    default:
      break;
  }
  return errors;
}

function fail(errors: ValidationError[]): ValidationResult {
  return { ok: false, errors };
}

/** Render validation errors as a single readable paragraph for the AI panel. */
export function describeErrors(errors: ValidationError[]): string {
  if (!errors.length) return '';
  return errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('\n');
}

/** Validate a batch, stopping at the first bad command so partial plans never run. */
export function validateCommandBatch(raws: unknown[]): { ok: true; commands: AiCommand[] } | { ok: false; index: number; errors: ValidationError[] } {
  const commands: AiCommand[] = [];
  for (let i = 0; i < raws.length; i++) {
    const result = validateCommand(raws[i]);
    if (!result.ok || !result.normalized) return { ok: false, index: i, errors: result.errors };
    commands.push(result.normalized);
  }
  return { ok: true, commands };
}
