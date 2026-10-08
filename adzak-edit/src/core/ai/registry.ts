import type { AiToolDefinition } from '../types/ai';
import { effectRegistry } from '../effects/registry';

/**
 * The AI tool registry — the complete, closed set of things a model may ask for.
 *
 * SECURITY MODEL
 * --------------
 * This list is the whitelist. A command whose `action` is not here is rejected
 * before it is even type-checked. Nothing in this file can reach the
 * filesystem, the network or a shell: handlers receive an `EditorApi` object
 * (see executor.ts) that exposes only timeline operations.
 */

const CLIP_ID = {
  type: 'string' as const,
  description: 'Clip id, e.g. "clip_12". Call get_timeline first to discover ids.',
  validate: (v: unknown) => {
    if (typeof v !== 'string' || v.length === 0 || v.length > 128) return 'Clip id must be a non-empty string.';
    if (!/^[\w~.-]+$/.test(v)) return 'Clip id contains invalid characters.';
    return null;
  },
};

const TIME_SEC = {
  type: 'number' as const,
  description: 'Time in seconds from the start of the timeline.',
  minimum: 0,
  maximum: 86_400,
};

export const AI_TOOLS: AiToolDefinition[] = [
  /* ------------------------- read-only ------------------------- */
  {
    name: 'get_project',
    humanTitle: () => 'Read the project summary',
    description: 'Returns project name, resolution, fps, asset list and total duration.',
    risk: 'safe',
    defaultPolicy: 'auto',
    readOnly: true,
    batchable: true,
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_timeline',
    humanTitle: () => 'Read the timeline',
    description: 'Returns every track and clip with ids, positions, durations and effects.',
    risk: 'safe',
    defaultPolicy: 'auto',
    readOnly: true,
    batchable: true,
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_selected_clip',
    humanTitle: () => 'Read the selected clip',
    description: 'Returns the currently selected clip, or an error when nothing is selected.',
    risk: 'safe',
    defaultPolicy: 'auto',
    readOnly: true,
    batchable: true,
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_clip',
    humanTitle: (a) => `Read clip ${String(a['clipId'] ?? '')}`,
    description: 'Returns a single clip by id.',
    risk: 'safe',
    defaultPolicy: 'auto',
    readOnly: true,
    batchable: true,
    schema: { type: 'object', properties: { clipId: CLIP_ID }, required: ['clipId'], additionalProperties: false },
  },
  {
    name: 'search_media',
    humanTitle: (a) => `Search media for "${String(a['query'] ?? '')}"`,
    description: 'Searches imported assets by name.',
    risk: 'safe',
    defaultPolicy: 'auto',
    readOnly: true,
    batchable: true,
    schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to search for', validate: (v) => (String(v).length > 200 ? 'Query too long.' : null) } },
      required: ['query'],
      additionalProperties: false,
    },
  },

  /* ------------------------- mutations ------------------------- */
  {
    name: 'split_clip',
    humanTitle: (a) => `Split ${String(a['clipId'])} at ${Number(a['time']).toFixed(2)}s`,
    description: 'Split a clip into two at a timeline time. Non-destructive.',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: { clipId: CLIP_ID, time: TIME_SEC },
      required: ['clipId', 'time'],
      additionalProperties: false,
    },
  },
  {
    name: 'trim_clip',
    humanTitle: (a) => `Trim ${String(a['clipId'])} ${String(a['edge'])} to ${Number(a['time']).toFixed(2)}s`,
    description: 'Move the in or out point of a clip to a timeline time.',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        edge: { type: 'string', enum: ['in', 'out'], description: 'Which handle to move' },
        time: TIME_SEC,
      },
      required: ['clipId', 'edge', 'time'],
      additionalProperties: false,
    },
  },
  {
    name: 'move_clip',
    humanTitle: (a) => `Move ${String(a['clipId'])} to ${Number(a['start']).toFixed(2)}s`,
    description: 'Move a clip to a new start time, optionally onto another track.',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        start: TIME_SEC,
        trackId: { type: 'string', description: 'Destination track id; omit to stay put' },
      },
      required: ['clipId', 'start'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_clip',
    humanTitle: (a) => `Delete ${String(a['clipId'])}${a['ripple'] ? ' (ripple)' : ''}`,
    description: 'Remove a clip from the timeline. The source file is never touched.',
    risk: 'destructive',
    defaultPolicy: 'confirm-always',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        ripple: { type: 'boolean', description: 'Close the gap left behind' },
      },
      required: ['clipId', 'ripple'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_text',
    humanTitle: (a) => `Add text "${String(a['text']).slice(0, 24)}"`,
    description: 'Add a text layer to the timeline.',
    risk: 'safe',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text content', validate: (v) => (String(v).length > 500 ? 'Text is too long (max 500 chars).' : null) },
        start: TIME_SEC,
        duration: { type: 'number', minimum: 0.2, maximum: 600 },
        trackId: { type: 'string' },
      },
      required: ['text', 'start', 'duration'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_subtitle',
    humanTitle: (a) => `Add subtitle "${String(a['text']).slice(0, 24)}"`,
    description: 'Add one subtitle cue.',
    risk: 'safe',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', validate: (v) => (String(v).length > 300 ? 'Subtitle is too long.' : null) },
        start: TIME_SEC,
        end: TIME_SEC,
        trackId: { type: 'string' },
      },
      required: ['text', 'start', 'end'],
      additionalProperties: false,
    },
  },
  {
    name: 'change_speed',
    humanTitle: (a) => `Set ${String(a['clipId'])} to ${Number(a['speed'])}x`,
    description: 'Change playback rate. 1.0 is normal speed.',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        speed: { type: 'number', minimum: 0.1, maximum: 16, description: 'Playback rate; 2 = double speed' },
        keepPitch: { type: 'boolean', description: 'Preserve the original pitch' },
      },
      required: ['clipId', 'speed', 'keepPitch'],
      additionalProperties: false,
    },
  },
  {
    name: 'reverse_clip',
    humanTitle: (a) => `${a['reverse'] ? 'Reverse' : 'Un-reverse'} ${String(a['clipId'])}`,
    description: 'Play the clip backwards.',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: { clipId: CLIP_ID, reverse: { type: 'boolean' } },
      required: ['clipId', 'reverse'],
      additionalProperties: false,
    },
  },
  {
    name: 'crop_video',
    humanTitle: (a) => `Crop ${String(a['clipId'])}`,
    description: 'Crop a clip. Values are fractions of the frame (0..0.49).',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        top: { type: 'number', minimum: 0, maximum: 0.49 },
        right: { type: 'number', minimum: 0, maximum: 0.49 },
        bottom: { type: 'number', minimum: 0, maximum: 0.49 },
        left: { type: 'number', minimum: 0, maximum: 0.49 },
      },
      required: ['clipId', 'top', 'right', 'bottom', 'left'],
      additionalProperties: false,
      // Cross-field guard: the four sides must leave a visible area.
      validate: (args) => {
        const top = Number(args['top'] ?? 0);
        const right = Number(args['right'] ?? 0);
        const bottom = Number(args['bottom'] ?? 0);
        const left = Number(args['left'] ?? 0);
        if (left + right >= 0.9) return 'The crop leaves no horizontal area.';
        if (top + bottom >= 0.9) return 'The crop leaves no vertical area.';
        return null;
      },
    },
  },
  {
    name: 'resize_video',
    humanTitle: (a) => `Resize sequence to ${Number(a['width'])}×${Number(a['height'])}`,
    description: 'Change the sequence (project) resolution, e.g. 1080×1920 for a Short.',
    risk: 'moderate',
    defaultPolicy: 'confirm-always',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: {
        width: { type: 'integer', minimum: 240, maximum: 7680 },
        height: { type: 'integer', minimum: 240, maximum: 4320 },
      },
      required: ['width', 'height'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_transition',
    humanTitle: (a) => `Add ${String(a['type'])} transition`,
    description: 'Insert a transition between two adjacent clips.',
    risk: 'moderate',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: {
        leftClipId: CLIP_ID,
        rightClipId: CLIP_ID,
        type: { type: 'string', enum: ['crossfade', 'fade-black', 'wipe-left', 'wipe-right', 'slide'] },
        duration: { type: 'number', minimum: 0.1, maximum: 5 },
      },
      required: ['leftClipId', 'rightClipId', 'type', 'duration'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_effect',
    humanTitle: (a) => `Add "${String(a['effectId'])}" effect to ${String(a['clipId'])}`,
    description: 'Attach a registered effect to a clip.',
    risk: 'safe',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        effectId: {
          type: 'string',
          description: 'Registered effect id',
          validate: (v) => (effectRegistry.has(String(v)) ? null : `Unknown effect "${String(v)}". Use get_project to list available effects.`),
        },
        params: {
          type: 'object',
          description: 'Optional parameter overrides',
          properties: {},
          additionalProperties: true,
        },
      },
      required: ['clipId', 'effectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_volume',
    humanTitle: (a) => `Set ${String(a['clipId'])} volume to ${Number(a['volumeDb']).toFixed(1)} dB`,
    description: 'Set clip volume in decibels. 0 dB is the original level.',
    risk: 'safe',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: { clipId: CLIP_ID, volumeDb: { type: 'number', minimum: -60, maximum: 12 } },
      required: ['clipId', 'volumeDb'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_keyframe',
    humanTitle: (a) => `Keyframe ${String(a['property'])} on ${String(a['clipId'])}`,
    description: 'Add a keyframe to an animatable property.',
    risk: 'safe',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: true,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        property: {
          type: 'string',
          enum: ['position.x', 'position.y', 'scale', 'rotation', 'opacity', 'volume', 'pan'],
        },
        time: { type: 'number', minimum: 0, maximum: 86_400, description: 'Seconds from clip start' },
        value: { type: 'number', description: 'Keyframe value' },
      },
      required: ['clipId', 'property', 'time', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_silence',
    humanTitle: (a) =>
      a['dryRun']
        ? `Analyse ${String(a['clipId'])} for silence`
        : `Remove silence from ${String(a['clipId'])}`,
    description:
      'Detect and optionally remove silent sections. Always pass dryRun=true first so the user can review what would be cut.',
    risk: 'destructive',
    defaultPolicy: 'confirm-always',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: {
        clipId: CLIP_ID,
        thresholdDb: { type: 'number', minimum: -90, maximum: -12 },
        minSilenceSec: { type: 'number', minimum: 0.1, maximum: 30 },
        dryRun: { type: 'boolean', description: 'true = only report, do not cut' },
      },
      required: ['clipId', 'thresholdDb', 'minSilenceSec', 'dryRun'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_sequence',
    humanTitle: (a) => `Create sequence "${String(a['name'])}" ${Number(a['width'])}×${Number(a['height'])}`,
    description: 'Create a new empty sequence (e.g. a 9:16 Short from a 16:9 master).',
    risk: 'moderate',
    defaultPolicy: 'confirm-always',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        width: { type: 'integer', minimum: 240, maximum: 7680 },
        height: { type: 'integer', minimum: 240, maximum: 4320 },
        fps: { type: 'integer', minimum: 12, maximum: 120 },
      },
      required: ['name', 'width', 'height', 'fps'],
      additionalProperties: false,
    },
  },
  {
    name: 'export_video',
    humanTitle: (a) => `Queue an export (${String(a['preset'])})`,
    description:
      'Prepare an export job. The user always confirms the final dialog; this never writes a file by itself.',
    risk: 'destructive',
    defaultPolicy: 'confirm-always',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: ['youtube-1080', 'youtube-4k', 'shorts-1080', 'tiktok-1080', 'instagram-reel', 'instagram-square', 'custom'],
        },
        path: { type: 'string', description: 'Optional output path' },
      },
      required: ['preset'],
      additionalProperties: false,
    },
  },
  {
    name: 'transcribe_clip',
    humanTitle: (a) => `Transcribe ${String(a['clipId'])} locally`,
    description: 'Run local speech recognition on a clip and produce editable subtitles.',
    risk: 'safe',
    defaultPolicy: 'confirm-once',
    readOnly: false,
    batchable: false,
    schema: {
      type: 'object',
      properties: { clipId: CLIP_ID, language: { type: 'string', description: 'BCP-47 code, e.g. "en"' } },
      required: ['clipId'],
      additionalProperties: false,
    },
  },
];

export const TOOL_BY_NAME: Map<string, AiToolDefinition> = new Map(AI_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AiToolDefinition | undefined {
  return TOOL_BY_NAME.get(name);
}

export function listToolNames(): string[] {
  return AI_TOOLS.map((t) => t.name);
}

/** Compact tool description fed to the model as its system prompt. */
export function toolManifestForPrompt(): string {
  return AI_TOOLS.map((tool) => {
    const params = Object.entries(tool.schema.properties)
      .map(([name, prop]) => {
        const bits = [`${name}: ${prop.type}`];
        if (prop.enum) bits.push(`one of ${prop.enum.join('|')}`);
        if (prop.minimum !== undefined || prop.maximum !== undefined) {
          bits.push(`range ${prop.minimum ?? '-inf'}..${prop.maximum ?? 'inf'}`);
        }
        if (tool.schema.required?.includes(name)) bits.push('required');
        if (prop.description) bits.push(prop.description);
        return `    - ${bits.join(', ')}`;
      })
      .join('\n');
    return `  ${tool.name} [risk: ${tool.risk}]\n    ${tool.description}\n${params || '    (no arguments)'}`;
  }).join('\n');
}
