import { getModelStatus, invokeNative } from './platform.js';
import { getAllClips, getTimelineDuration } from './project.js';

export class LocalAIRequiredError extends Error {
  constructor(message = 'Local AI model required') {
    super(message);
    this.name = 'LocalAIRequiredError';
  }
}

const ALLOWED_TOOLS = new Set([
  'remove_range', 'set_aspect_ratio', 'set_volume', 'trim_to_duration',
  'normalize_audio', 'move_clip', 'split_clip',
]);

function extractJson(text) {
  const content = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The installed local model did not return a valid structured plan.');
  return JSON.parse(content.slice(start, end + 1));
}

function safeNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`The local plan contains an invalid ${label}.`);
  return number;
}

export function projectContext(project, selectedClipId = null) {
  const selected = getAllClips(project).find((clip) => clip.id === selectedClipId) ?? null;
  return {
    projectName: project.name,
    duration: getTimelineDuration(project),
    sequence: { ...project.settings },
    assets: project.assets.map(({ id, name, mediaType, duration, width, height, hasAudio }) => ({ id, name, mediaType, duration, width, height, hasAudio })),
    tracks: project.tracks.map((track) => ({ id: track.id, name: track.name, type: track.type, muted: track.muted, locked: track.locked, clips: track.clips.map((clip) => ({ id: clip.id, assetId: clip.assetId, startTime: clip.startTime, duration: clip.duration, sourceIn: clip.sourceIn, volume: clip.volume, text: clip.text })) })),
    selectedClipId: selected?.id ?? null,
    recentConversation: (project.conversation ?? []).slice(-12).map((message) => ({ role: message.role, text: String(message.text ?? '').slice(0, 1200) })),
  };
}

export function validateLocalPlan(raw, project) {
  const data = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!data || !Array.isArray(data.actions)) throw new Error('The local model plan is missing its action list.');
  const duration = getTimelineDuration(project);
  const actions = data.actions.map((action) => {
    if (!action || !ALLOWED_TOOLS.has(action.tool)) throw new Error(`Blocked unsupported AI tool: ${String(action?.tool ?? 'unknown')}.`);
    const args = action.arguments ?? {};
    switch (action.tool) {
      case 'remove_range': {
        const start = safeNumber(args.start, 0, Math.max(duration, 1), 'range start');
        const end = safeNumber(args.end, start, Math.max(duration + 1, 1), 'range end');
        return { type: 'remove_range', start, end, ripple: true };
      }
      case 'set_aspect_ratio': {
        if (!['16:9', '9:16', '1:1', '4:5'].includes(args.ratio)) throw new Error('The local plan selected an unsupported aspect ratio.');
        return { type: 'set_aspect_ratio', ratio: args.ratio };
      }
      case 'set_volume': {
        const multiplier = safeNumber(args.multiplier, 0, 4, 'volume multiplier');
        return { type: 'set_volume', multiplier, trackType: args.trackType === 'audio' ? 'audio' : null };
      }
      case 'trim_to_duration':
        return { type: 'trim_to_duration', duration: safeNumber(args.duration, 0.1, Math.max(duration, 0.1), 'target duration') };
      case 'normalize_audio': return { type: 'normalize_audio' };
      case 'move_clip': {
        const clipId = String(args.clipId ?? '');
        if (!getAllClips(project).some((clip) => clip.id === clipId)) throw new Error('The local plan refers to an unknown clip.');
        return { type: 'move_clip', clipId, startTime: safeNumber(args.startTime, 0, Math.max(duration * 2, 600), 'clip position') };
      }
      case 'split_clip': {
        const clipId = String(args.clipId ?? '');
        if (!getAllClips(project).some((clip) => clip.id === clipId)) throw new Error('The local plan refers to an unknown clip.');
        return { type: 'split_clip', clipId, atTime: safeNumber(args.atTime, 0, Math.max(duration, 1), 'split position') };
      }
      case 'add_captions': {
        if (!Array.isArray(args.segments) || args.segments.length > 10000) throw new Error('The local plan contains an invalid caption list.');
        const segments = args.segments.map((segment) => ({ startTime: safeNumber(segment.startTime, 0, Math.max(duration, 1), 'caption start'), endTime: safeNumber(segment.endTime, 0, Math.max(duration + 1, 1), 'caption end'), text: String(segment.text ?? '').slice(0, 500) }));
        return { type: 'add_captions', segments };
      }
      case 'add_speech_zooms': {
        if (!Array.isArray(args.segments) || args.segments.length > 1000) throw new Error('The local plan contains invalid speech ranges.');
        return { type: 'add_speech_zooms', zoom: safeNumber(args.zoom ?? 1.12, 1, 2, 'zoom'), segments: args.segments.map((segment) => ({ startTime: safeNumber(segment.startTime, 0, Math.max(duration, 1), 'speech start'), endTime: safeNumber(segment.endTime, 0, Math.max(duration + 1, 1), 'speech end') })) };
      }
      default: throw new Error('The local plan contains a tool that is not enabled.');
    }
  });
  return { summary: String(data.summary ?? 'Local editing plan').slice(0, 240), actions };
}

export class LocalAIEngine {
  constructor() { this.modelStatus = null; }

  async refreshModels() {
    this.modelStatus = await getModelStatus();
    return this.modelStatus;
  }

  async planWithLocalModel(command, project, selectedClipId = null) {
    const status = this.modelStatus ?? await this.refreshModels();
    if (!status?.llm?.installed || !status?.llm?.runtimeAvailable) {
      throw new LocalAIRequiredError('Local AI model required. Install a local GGUF model and llama.cpp runtime in AI Model Manager to use semantic editing commands.');
    }
    const context = projectContext(project, selectedClipId);
    const result = await invokeNative('generate_local_plan', { command, projectState: JSON.stringify(context) });
    return validateLocalPlan(result, project);
  }
}
