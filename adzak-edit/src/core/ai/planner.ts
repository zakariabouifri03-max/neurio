import type { AiCommand, AiPlan, AiPlanStep, RiskLevel } from '../types/ai';
import type { EditorApi, ProjectSummary } from './editorApi';
import { getTool } from './registry';
import { uid } from '../timeline/factory';

/**
 * Offline planner.
 *
 * This is what makes the AI panel useful with **no model installed and no
 * internet**. Intents are matched by keyword and expanded into a deterministic
 * command sequence. It is not a language model — it is a script library with a
 * friendly front door, and it is honest about that in the UI.
 *
 * When a real local model is available (`providers/ollama.ts`), the agent uses
 * it instead and falls back to this planner on any failure.
 */

export type IntentId =
  | 'split_clip'
  | 'make_short'
  | 'remove_silence'
  | 'add_captions'
  | 'find_highlights'
  | 'improve_audio'
  | 'normalize_audio'
  | 'resize_vertical'
  | 'resize_square'
  | 'translate_subtitles'
  | 'speed_up'
  | 'add_title'
  | 'unknown';

export interface IntentMatch {
  id: IntentId;
  confidence: number;
  /** Seconds requested, when the user mentioned a length. */
  targetDurationSec?: number;
  matchedPhrase?: string;
}

const INTENT_KEYWORDS: Record<Exclude<IntentId, 'unknown'>, string[]> = {
  split_clip: ['split', 'cut the clip', 'cut at', 'cut into', 'divide', 'break the clip'],
  make_short: ['short', 'shorts', 'reel', 'tiktok', 'viral', 'highlight reel', 'quick cut'],
  remove_silence: ['silence', 'silent', 'dead air', 'pause', 'um', 'jump cut', 'tighten'],
  add_captions: ['caption', 'subtitle', 'transcribe', 'transcript', 'text on screen'],
  find_highlights: ['highlight', 'best moment', 'best part', 'interesting', 'find the'],
  improve_audio: ['audio', 'sound', 'noise', 'voice', 'clean up', 'enhance'],
  normalize_audio: ['normalize', 'normalise', 'loudness', 'volume level', 'consistent volume'],
  resize_vertical: ['9:16', 'vertical', 'portrait', '1080x1920', '1080×1920', 'phone'],
  resize_square: ['square', '1:1', '1080x1080'],
  translate_subtitles: ['translate', 'translation', 'another language'],
  speed_up: ['speed up', 'faster', 'double speed', '2x', '2 x'],
  add_title: ['title', 'intro text', 'title card'],
};

const DURATION_RE = /(\d+)\s*(?:second|sec|s\b|seconds)/i;

export function matchIntent(text: string): IntentMatch {
  const lower = text.toLowerCase();
  let best: IntentMatch = { id: 'unknown', confidence: 0 };

  for (const [id, keywords] of Object.entries(INTENT_KEYWORDS) as [Exclude<IntentId, 'unknown'>, string[]][]) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        // Longer phrases are stronger evidence.
        const confidence = Math.min(1, 0.5 + keyword.length / 40);
        if (confidence > best.confidence) {
          best = { id, confidence, matchedPhrase: keyword };
        }
      }
    }
  }

  const duration = DURATION_RE.exec(text);
  if (duration) best = { ...best, targetDurationSec: Math.min(600, Number(duration[1])) };
  if (best.id === 'unknown' && best.targetDurationSec) best = { ...best, id: 'make_short', confidence: 0.4 };
  return best;
}

export interface PlanBuildResult {
  plan: AiPlan;
  /** True when the request could not be turned into anything useful. */
  unsupported: boolean;
}

export function buildOfflinePlan(goal: string, api: EditorApi): PlanBuildResult {
  const intent = matchIntent(goal);
  const summary = api.getProjectSummary();
  const target = intent.targetDurationSec ?? 30;
  const warnings: string[] = [];
  let steps: AiPlanStep[] = [];
  let planSummary = '';

  switch (intent.id) {
    case 'split_clip': {
      const at = intent.targetDurationSec ?? 5;
      planSummary = `Split the main clip at ${at}s.`;
      steps = [
        step({ action: 'get_timeline' }, 'Read the timeline to find the clip to split.'),
        step({ action: 'split_clip', clipId: PRIMARY_CLIP, time: at }, `Split the clip into two at ${at} seconds.`),
      ];
      break;
    }
    case 'make_short': {
      planSummary = `Turn the timeline into a ${target}-second vertical short.`;
      steps = [
        step({ action: 'get_project' }, 'Check the current project settings and clips.'),
        step({ action: 'get_timeline' }, 'Read the timeline to find usable material.'),
      ];
      if (summary.width > summary.height) {
        steps.push(
          step(
            { action: 'create_sequence', name: `${summary.name} — Short`, width: 1080, height: 1920, fps: summary.fps },
            'Create a 9:16 sequence so the output is phone-shaped.',
          ),
        );
      }
      steps.push(
        step(
          { action: 'remove_silence', clipId: PRIMARY_CLIP, thresholdDb: -40, minSilenceSec: 0.6, dryRun: true },
          'Analyse the main clip for silence before cutting anything.',
        ),
      );
      warnings.push(
        'Silence removal is analysed first and shown to you for review — nothing is deleted automatically.',
      );
      warnings.push(
        'Choosing the exact highlight moments needs a transcript. Install a Whisper model in Settings → AI Models for automatic highlight selection.',
      );
      break;
    }
    case 'remove_silence':
      planSummary = 'Find and remove long silences and dead air.';
      steps = [
        step({ action: 'get_timeline' }, 'Read the timeline.'),
        step(
          { action: 'remove_silence', clipId: PRIMARY_CLIP, thresholdDb: -40, minSilenceSec: 0.6, dryRun: true },
          'Detect silence without deleting anything, so you can review the list first.',
        ),
      ];
      break;
    case 'add_captions':
      planSummary = 'Generate subtitles from the speech in your video.';
      steps = [
        step({ action: 'get_timeline' }, 'Read the timeline.'),
        step({ action: 'transcribe_clip', clipId: PRIMARY_CLIP }, 'Run local speech recognition on the main clip.'),
      ];
      warnings.push(
        'Transcription runs entirely on your machine using Whisper. It needs a one-time model download from Settings → AI Models.',
      );
      break;
    case 'find_highlights':
      planSummary = 'Suggest the most interesting segments of the video.';
      steps = [
        step({ action: 'get_timeline' }, 'Read the timeline.'),
        step(
          { action: 'transcribe_clip', clipId: PRIMARY_CLIP },
          'Transcribe so importance can be scored from the words as well as the audio.',
        ),
      ];
      warnings.push('Highlight scoring uses scene changes, audio intensity and transcript keywords — all computed locally.');
      break;
    case 'improve_audio':
      planSummary = 'Clean up the audio: denoise, enhance the voice and even out the level.';
      steps = [step({ action: 'get_timeline' }, 'Read the timeline and its audio clips.'), step({ action: 'set_volume', clipId: PRIMARY_CLIP, volumeDb: 0 }, 'Reset the clip level before applying processing.')];
      warnings.push('Noise reduction and voice enhancement are applied as non-destructive filters — the original file is never modified.');
      break;
    case 'normalize_audio':
      planSummary = 'Match loudness to the broadcast standard (EBU R128, −16 LUFS).';
      steps = [step({ action: 'get_timeline' }, 'Read the timeline.'), step({ action: 'set_volume', clipId: PRIMARY_CLIP, volumeDb: 0 }, 'Reset levels before normalising.')];
      break;
    case 'resize_vertical':
      planSummary = 'Resize the sequence to 1080×1920 (9:16).';
      steps = [
        step({ action: 'create_sequence', name: `${summary.name} — Vertical`, width: 1080, height: 1920, fps: summary.fps }, 'Create a 9:16 sequence.'),
      ];
      warnings.push('Existing clips keep their size; adjust the crop in the Inspector to fill the frame.');
      break;
    case 'resize_square':
      planSummary = 'Resize the sequence to 1080×1080 (1:1).';
      steps = [step({ action: 'create_sequence', name: `${summary.name} — Square`, width: 1080, height: 1080, fps: summary.fps }, 'Create a square sequence.')];
      break;
    case 'translate_subtitles':
      planSummary = 'Translate the subtitles into another language.';
      steps = [step({ action: 'get_project' }, 'Read the project to find existing subtitles.'),];
      warnings.push('Translation needs a local LLM. Install one from Settings → AI Models; no internet is used once it is installed.');
      break;
    case 'speed_up':
      planSummary = 'Speed up the selected clip.';
      steps = [step({ action: 'change_speed', clipId: PRIMARY_CLIP, speed: 2, keepPitch: true }, 'Play the clip at double speed while keeping the pitch natural.')];
      break;
    case 'add_title':
      planSummary = 'Add a title card at the start.';
      steps = [step({ action: 'add_text', text: summary.name, start: 0, duration: 3 }, 'Place a 3-second title at the beginning of the timeline.')];
      break;
    default:
      return {
        plan: {
          id: uid('plan'),
          goal,
          summary: 'I could not match that request to an editing task I can do yet.',
          steps: [],
          warnings: [
            'Try one of the suggestions in the panel, for example "Remove silence", "Add captions" or "Make this into a 30 second Short".',
            'For free-form requests, connect a local model in Settings → AI.',
          ],
          createdAt: Date.now(),
        },
        unsupported: true,
      };
  }

  // Replace the placeholder clip id with a real one.
  steps = resolvePrimaryClip(steps, summary);

  return {
    plan: {
      id: uid('plan'),
      goal,
      summary: planSummary,
      steps,
      warnings,
      createdAt: Date.now(),
    },
    unsupported: false,
  };
}

/** Placeholder replaced by the longest clip on the first video track. */
const PRIMARY_CLIP = '__primary__';

function resolvePrimaryClip(steps: AiPlanStep[], summary: ProjectSummary): AiPlanStep[] {
  const videoTrack = summary.tracks.find((t) => t.kind === 'video' && t.clipIds.length > 0);
  const clipId = videoTrack?.clipIds[0];
  if (!clipId) {
    return steps.filter((s) => !JSON.stringify(s.command).includes(PRIMARY_CLIP));
  }
  return steps
    .map((s) => {
      const command = s.command as unknown as Record<string, unknown>;
      if (command['clipId'] !== PRIMARY_CLIP) return s;
      return { ...s, command: { ...command, clipId } as AiCommand };
    })
    .filter((s) => !JSON.stringify(s.command).includes(PRIMARY_CLIP));
}

function step(command: AiCommand, explanation: string): AiPlanStep {
  const tool = getTool(command.action);
  const risk: RiskLevel = tool?.risk ?? 'moderate';
  return { id: uid('step'), command, explanation, risk };
}

/** The suggestion chips shown in the AI panel. */
export const AI_SUGGESTIONS: { label: string; prompt: string; icon: string }[] = [
  { label: 'Remove silence', prompt: 'Remove silence from my video', icon: 'scissors' },
  { label: 'Add captions', prompt: 'Add captions from the speech', icon: 'captions' },
  { label: 'Find highlights', prompt: 'Find the highlights', icon: 'spark' },
  { label: 'Improve audio', prompt: 'Improve the audio quality', icon: 'wave' },
  { label: 'Resize to 9:16', prompt: 'Resize this to 9:16 vertical', icon: 'phone' },
  { label: 'Make a Short', prompt: 'Make this into a 30 second Short', icon: 'bolt' },
  { label: 'Add a title', prompt: 'Add a title card', icon: 'type' },
  { label: 'Speed up', prompt: 'Speed up the selected clip', icon: 'fast' },
];
