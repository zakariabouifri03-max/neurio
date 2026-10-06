import {
  addCaptionSegments, addEffect, addSpeechZooms, adjustProjectVolume,
  getAllClips, getAssetById, getClipById, getTimelineDuration, moveClip,
  normalizeProjectAudio, removeRanges, removeTimelineRange, setAspectRatio,
  splitClip, trimToDuration,
} from './project.js';
import { isDesktopApp, invokeNative } from './platform.js';
import { LocalAIEngine } from './local-ai-engine.js';
import { formatTime } from './time.js';

const aiEngine = new LocalAIEngine();

export function refreshAIModels() { return aiEngine.refreshModels(); }

function compactRanges(ranges) {
  const sorted = ranges.filter(([a, b]) => b - a > 0.04).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 0.06) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

async function analyzeSilences(project, minimumDuration) {
  if (!isDesktopApp()) throw new Error('Silence detection requires the desktop FFmpeg engine. Open this project in the Windows desktop app, then run Analyze silence.');
  const candidates = new Map();
  for (const clip of getAllClips(project).filter((item) => ['video', 'audio'].includes(item.trackType))) {
    if (!candidates.has(clip.assetId)) candidates.set(clip.assetId, []);
    candidates.get(clip.assetId).push(clip);
  }
  const ranges = [];
  const cache = [];
  for (const [assetId, clips] of candidates) {
    const asset = getAssetById(project, assetId);
    if (!asset?.path) throw new Error(`Media “${asset?.name ?? assetId}” is not available to the desktop FFmpeg engine. Relink the source file first.`);
    const result = await invokeNative('analyze_silence', { path: asset.path, noiseDb: -35, minDuration: Math.max(0.15, minimumDuration * 0.5) });
    cache.push({ assetId, result });
    for (const clip of clips) {
      for (const silence of result.intervals ?? []) {
        const sourceStart = Math.max(Number(silence.start), Number(clip.sourceIn) || 0);
        const sourceEnd = Math.min(Number(silence.end), Number(clip.sourceOut) || asset.duration);
        if (sourceEnd - sourceStart < minimumDuration) continue;
        const timelineStart = clip.startTime + sourceStart - (Number(clip.sourceIn) || 0);
        const timelineEnd = timelineStart + (sourceEnd - sourceStart);
        ranges.push([timelineStart, timelineEnd]);
      }
    }
  }
  return { ranges: compactRanges(ranges), cache };
}

async function transcribeTimeline(project, language = null) {
  if (!isDesktopApp()) throw new Error('Local AI model required — captions need a local Whisper model and runtime in the Windows desktop app.');
  const targets = new Map();
  for (const clip of getAllClips(project).filter((item) => ['video', 'audio'].includes(item.trackType))) {
    const asset = getAssetById(project, clip.assetId);
    if (!asset?.path) continue;
    if (asset.mediaType === 'audio' || (asset.mediaType === 'video' && asset.hasAudio)) {
      if (!targets.has(asset.id)) targets.set(asset.id, []);
      targets.get(asset.id).push(clip);
    }
  }
  if (!targets.size) throw new Error('No audio-bearing clips are on the timeline. Add a video or audio clip with sound first.');
  const resultSegments = [];
  const cache = [];
  for (const [assetId, clips] of targets) {
    const asset = getAssetById(project, assetId);
    const response = await invokeNative('transcribe_media', { path: asset.path, language });
    cache.push({ assetId, response });
    for (const clip of clips) {
      for (const segment of response.segments ?? []) {
        const sourceStart = Math.max(Number(segment.start), Number(clip.sourceIn) || 0);
        const sourceEnd = Math.min(Number(segment.end), Number(clip.sourceOut) || asset.duration);
        if (sourceEnd - sourceStart < 0.025) continue;
        resultSegments.push({
          startTime: clip.startTime + sourceStart - (Number(clip.sourceIn) || 0),
          endTime: clip.startTime + sourceEnd - (Number(clip.sourceIn) || 0),
          text: String(segment.text ?? '').trim(),
        });
      }
    }
  }
  return { segments: resultSegments.sort((a, b) => a.startTime - b.startTime), cache };
}

function extractTargetDuration(command) {
  const patterns = [
    /\b(?:make|create|keep|trim)\b[^\d]{0,22}(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i,
    /\b(?:to|under|within)\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i,
    /\b(15|30|45|60)\s*(?:seconds?|secs?|s)\b/i,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function describeAction(action, project) {
  switch (action.type) {
    case 'remove_range': return `Remove ${formatTime(action.start)}–${formatTime(action.end)} and ripple later clips left`;
    case 'remove_ranges': return `Remove ${action.ranges.length} silent section${action.ranges.length === 1 ? '' : 's'} (${action.ranges.reduce((sum, range) => sum + range[1] - range[0], 0).toFixed(1)} sec total)`;
    case 'set_aspect_ratio': return `Set the sequence to ${action.ratio}`;
    case 'trim_to_duration': return `Keep the first ${action.duration} seconds (no speed-up)`;
    case 'set_volume': return `${action.multiplier < 1 ? 'Lower' : 'Raise'} clip audio to ${Math.round(action.multiplier * 100)}% of its current level`;
    case 'add_captions': return `Add ${action.segments.length} locally transcribed caption${action.segments.length === 1 ? '' : 's'}`;
    case 'add_speech_zooms': return `Add ${action.segments.length} speaker zoom range${action.segments.length === 1 ? '' : 's'} to video keyframes`;
    case 'normalize_audio': return 'Add FFmpeg loudness normalization to audio clips';
    case 'move_clip': return `Move selected clip to ${formatTime(action.startTime)}`;
    case 'split_clip': return `Split the selected clip at ${formatTime(action.atTime)}`;
    case 'caption_style': return 'Update caption styling';
    default: return action.label ?? 'Modify timeline';
  }
}

function buildPlan(command, actions, options = {}) {
  const { warnings = [], cache = [], review = false, summary = null, unavailable = [] } = options;
  return {
    command,
    actions,
    warnings,
    cache,
    unavailable,
    summary: summary ?? (actions.length ? `I prepared ${actions.length} timeline change${actions.length === 1 ? '' : 's'}.` : 'No timeline changes are needed.'),
    steps: actions.map((action) => describeAction(action)),
    requiresReview: review || actions.length > 1 || unavailable.length > 0,
  };
}

export async function prepareCommand(commandText, project, selectedClipId = null, environment = {}) {
  const command = String(commandText ?? '').trim();
  if (!command) throw new Error('Type an editing command first.');
  const normalized = command.toLowerCase();
  if (/^\s*(undo|undo the last (?:change|edit|action))\s*[.!]?$/i.test(command)) return { control: 'undo', command };
  if (/^\s*(redo|redo the last (?:change|edit|action))\s*[.!]?$/i.test(command)) return { control: 'redo', command };

  const actions = [];
  const unavailable = [];
  const warnings = [];
  const cache = [];
  const duration = getTimelineDuration(project);
  let needsReview = false;

  const first = normalized.match(/\b(?:remove|delete|cut|trim)\s+(?:the\s+)?first\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/);
  if (first) actions.push({ type: 'remove_range', start: 0, end: Math.min(duration, Number(first[1])), ripple: true });

  const last = normalized.match(/\b(?:remove|delete|cut|trim)\s+(?:the\s+)?last\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/);
  if (last) actions.push({ type: 'remove_range', start: Math.max(0, duration - Number(last[1])), end: duration + 0.01, ripple: true });

  if (/\b(?:split|cut)\b/.test(normalized) && /\b(?:here|playhead|at this point)\b/.test(normalized)) {
    if (!selectedClipId) unavailable.push('Select a clip to split at the playhead.');
    else actions.push({ type: 'split_clip', clipId: selectedClipId, atTime: Number(environment.playhead) || 0 });
  }

  if (/\bmove\b/.test(normalized) && /\b(?:clip|this)\b/.test(normalized)) {
    const amount = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\s*(?:later|right|forward)\b/);
    if (!selectedClipId) unavailable.push('Select the clip you want to move.');
    else if (amount) {
      const found = getAllClips(project).find((clip) => clip.id === selectedClipId);
      if (found) actions.push({ type: 'move_clip', clipId: found.id, startTime: found.startTime + Number(amount[1]) });
    }
  }

  const silence = normalized.match(/\b(?:silence|silent sections?|pauses?)\b/);
  if (silence && /\b(?:remove|delete|cut|trim|every|all)\b/.test(normalized)) {
    const thresholdMatch = normalized.match(/(?:longer than|over|more than|above)\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/) ?? normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\s*(?:silence|pause)/);
    const threshold = Number(thresholdMatch?.[1] ?? 1);
    if (threshold <= 0 || threshold > 120) throw new Error('Choose a silence duration between 0 and 120 seconds.');
    const result = await analyzeSilences(project, threshold);
    cache.push({ kind: 'silence', threshold, assets: result.cache });
    const ranges = result.ranges.filter(([start, end]) => end - start >= threshold);
    if (ranges.length) actions.push({ type: 'remove_ranges', ranges, ripple: true });
    else warnings.push(`No silent sections longer than ${threshold} second${threshold === 1 ? '' : 's'} were detected.`);
    needsReview = true;
  }

  const asksShort = /\b(short|reel|tiktok|vertical|9\s*:\s*16)\b/.test(normalized);
  const asksCaptions = /\b(captions?|subtitles?)\b/.test(normalized) && /\b(add|generate|create|make)\b/.test(normalized);
  const asksSpeakerZoom = /\bzoom\b/.test(normalized) && /\b(speak|talk|speaker|person|voice)\b/.test(normalized);
  if (asksCaptions || asksSpeakerZoom || asksShort) {
    try {
      const language = /\benglish\b/.test(normalized) ? 'en' : null;
      const transcript = await transcribeTimeline(project, language);
      cache.push({ kind: 'transcript', assets: transcript.cache });
      if (asksCaptions || asksShort) actions.push({ type: 'add_captions', segments: transcript.segments, style: { fontSize: 42, position: 'lower-center', outline: true } });
      if (asksSpeakerZoom) actions.push({ type: 'add_speech_zooms', segments: transcript.segments, zoom: 1.12 });
      needsReview = true;
    } catch (error) {
      unavailable.push(error.message.includes('Whisper') || error.message.includes('model')
        ? 'Local AI model required — install a Whisper-compatible local model and whisper.cpp runtime in AI Model Manager.'
        : error.message);
    }
  }

  if (asksShort) {
    actions.push({ type: 'set_aspect_ratio', ratio: '9:16' });
    needsReview = true;
    if (/\b(?:interesting|important|boring|viral|highlights?|best moments?)\b/.test(normalized)) {
      warnings.push('Semantic highlight selection is not applied without a local LLM/vision model. No moments were guessed or discarded.');
      unavailable.push('Local vision analysis is unavailable in this build. The language model cannot inspect footage, so no content-based highlights were guessed or removed.');
    }
  }

  const targetDuration = extractTargetDuration(command);
  if (targetDuration != null && asksShort) {
    if (targetDuration <= 0 || targetDuration > 3600) throw new Error('Choose a duration between 1 second and 60 minutes.');
    if (duration > targetDuration + 0.02) actions.push({ type: 'trim_to_duration', duration: targetDuration });
    else if (duration + 0.02 < targetDuration) warnings.push(`The current timeline is ${duration.toFixed(1)} seconds long. It will not be sped up or duplicated to fill ${targetDuration} seconds.`);
    if (!/\b(?:interesting|important|boring|viral|highlights?|best moments?)\b/.test(normalized)) {
      warnings.push(`A ${targetDuration}-second Short keeps the opening section. Install local speech/vision models for content-aware highlight selection.`);
    }
    needsReview = true;
  } else if (targetDuration != null && !asksShort && /\b(?:make|trim|keep|shorten|under|to)\b/.test(normalized)) {
    if (duration > targetDuration + 0.02) actions.push({ type: 'trim_to_duration', duration: targetDuration });
    else warnings.push('The current timeline is already shorter than that target. No media was stretched.');
  }

  if (/\b(?:make|set|switch|change|convert)\b/.test(normalized) && /\b(?:16\s*:\s*9|landscape|widescreen)\b/.test(normalized)) actions.push({ type: 'set_aspect_ratio', ratio: '16:9' });
  if (/\b(?:square|1\s*:\s*1)\b/.test(normalized) && /\b(?:make|set|convert|change)\b/.test(normalized)) actions.push({ type: 'set_aspect_ratio', ratio: '1:1' });

  const volumeMatch = normalized.match(/\b(?:lower|reduce|decrease|raise|increase|boost|louder|quieter)\b[^.]{0,80}?(\d+(?:\.\d+)?)\s*%/);
  if (volumeMatch) {
    const percent = Number(volumeMatch[1]);
    if (percent > 100) throw new Error('A volume adjustment can be between 0% and 100%.');
    const lowering = /\b(lower|reduce|decrease|quieter)\b/.test(normalized);
    actions.push({ type: 'set_volume', multiplier: lowering ? 1 - percent / 100 : 1 + percent / 100, trackType: /\bmusic\b/.test(normalized) ? 'audio' : null });
  } else if (/\b(?:make|turn|increase|boost)\b[^.]{0,40}\b(?:louder|up)\b/.test(normalized)) {
    actions.push({ type: 'set_volume', multiplier: 1.2, trackType: null });
  } else if (/\b(?:lower|turn down|reduce)\b[^.]{0,40}\b(?:music|audio|volume)\b/.test(normalized)) {
    actions.push({ type: 'set_volume', multiplier: 0.7, trackType: /\bmusic\b/.test(normalized) ? 'audio' : null });
  }

  if (/\b(normalize|normalise)\b/.test(normalized) && /\b(audio|sound|volume)\b/.test(normalized)) {
    if (!isDesktopApp()) unavailable.push('Audio normalization requires the desktop FFmpeg engine.');
    else actions.push({ type: 'normalize_audio' });
  }

  if (/\b(?:remove|delete|cut)\b[^.]{0,30}\b(?:boring|repetitive|unnecessary)\b/.test(normalized) || /\bkeep only\b[^.]{0,30}\b(?:interesting|important)\b/.test(normalized)) {
    unavailable.push('Local vision analysis is unavailable in this build. The language model cannot inspect footage, so no content-based ranges were guessed or removed.');
  }

  if (/\bcaption(s)?\b/.test(normalized) && /\b(?:large|bigger|higher|above|lower|smaller)\b/.test(normalized) && !asksCaptions) {
    const fontSize = /\b(?:large|bigger)\b/.test(normalized) ? 56 : 42;
    actions.push({ type: 'caption_style', style: { fontSize, position: /\bhigher|above\b/.test(normalized) ? 'mid-lower' : 'lower-center' } });
  }

  if (!actions.length && unavailable.length === 0) {
    // Free-form requests are sent only to an installed local model. No remote endpoint exists.
    try {
      const generated = await aiEngine.planWithLocalModel(command, project, selectedClipId);
      actions.push(...generated.actions);
      needsReview = true;
      return buildPlan(command, actions, { review: true, summary: generated.summary || `The local model prepared ${actions.length} registered tool action(s).` });
    } catch (error) { throw error; }
  }

  if (!actions.length && unavailable.length) {
    return buildPlan(command, actions, { review: true, unavailable, warnings, summary: 'No edits were applied. Install the required local model or runtime to continue.' });
  }
  const actualChangeCount = actions.length;
  const review = needsReview || actualChangeCount > 1 || unavailable.length > 0;
  const summary = actualChangeCount
    ? `Prepared ${actualChangeCount} real timeline operation${actualChangeCount === 1 ? '' : 's'}${unavailable.length ? `; ${unavailable.length} requested feature${unavailable.length === 1 ? '' : 's'} unavailable` : ''}.`
    : 'Analysis complete. No matching timeline changes were found.';
  return buildPlan(command, actions, { review, summary, warnings, unavailable, cache });
}

export function applyProjectAction(project, action) {
  switch (action.type) {
    case 'remove_range': return removeTimelineRange(project, action.start, action.end, action.ripple !== false);
    case 'remove_ranges': return removeRanges(project, action.ranges, action.ripple !== false);
    case 'trim_to_duration': return trimToDuration(project, action.duration);
    case 'set_aspect_ratio': setAspectRatio(project, action.ratio); return true;
    case 'set_volume': {
      let count = adjustProjectVolume(project, action.multiplier, action.trackType ?? null);
      if (!count && action.trackType === 'audio') count = adjustProjectVolume(project, action.multiplier, null);
      if (!count) throw new Error('No audio clips with sound are available to adjust.');
      return count;
    }
    case 'normalize_audio': {
      const count = normalizeProjectAudio(project);
      if (!count) throw new Error('No audio clips are available to normalize.');
      return count;
    }
    case 'add_captions': {
      const captions = addCaptionSegments(project, action.segments, action.style);
      if (!captions.length) throw new Error('The local transcript did not contain captionable speech.');
      return captions.length;
    }
    case 'add_speech_zooms': {
      const count = addSpeechZooms(project, action.segments, action.zoom ?? 1.12);
      if (!count) throw new Error('No speech sections overlap the current video timeline.');
      return count;
    }
    case 'move_clip': if (!moveClip(project, action.clipId, action.startTime)) throw new Error('That clip cannot be moved.'); return true;
    case 'split_clip': if (!splitClip(project, action.clipId, action.atTime)) throw new Error('Move the playhead inside the selected clip before splitting.'); return true;
    case 'caption_style': {
      const track = project.tracks.find((item) => item.type === 'caption');
      if (!track?.clips.length) throw new Error('There are no captions to style yet.');
      for (const clip of track.clips) clip.style = { ...(clip.style ?? {}), ...action.style };
      return track.clips.length;
    }
    default: throw new Error(`Blocked unknown tool operation: ${String(action.type)}.`);
  }
}

export function applyPlan(store, plan) {
  if (!plan?.actions?.length) return false;
  return store.commit(plan.command, (draft) => {
    for (const item of plan.cache ?? []) {
      if (!draft.analysis) draft.analysis = { byAsset: {} };
      if (!draft.analysis.byAsset) draft.analysis.byAsset = {};
      if (item.kind === 'silence') {
        for (const entry of item.assets) draft.analysis.byAsset[entry.assetId] = { ...(draft.analysis.byAsset[entry.assetId] ?? {}), silence: entry.result, silenceAnalyzedAt: new Date().toISOString() };
      }
      if (item.kind === 'transcript') {
        for (const entry of item.assets) draft.analysis.byAsset[entry.assetId] = { ...(draft.analysis.byAsset[entry.assetId] ?? {}), transcript: entry.response, transcriptAnalyzedAt: new Date().toISOString() };
      }
    }
    const originalDuration = getTimelineDuration(draft);
    const cuts = [];
    const nonCutActions = [];
    for (const action of plan.actions) {
      if (action.type === 'remove_range') cuts.push([action.start, action.end]);
      else if (action.type === 'remove_ranges') cuts.push(...action.ranges);
      else if (action.type === 'trim_to_duration') {
        if (originalDuration > action.duration + 0.0001) cuts.push([action.duration, originalDuration + 0.001]);
      } else nonCutActions.push(action);
    }
    // Transcripts/keyframes are placed in the analyzed source-time coordinates first;
    // applying ripple cuts last then shifts those clips and keyframes non-destructively.
    for (const action of nonCutActions) applyProjectAction(draft, action);
    const ordered = cuts.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ordered) {
      const tail = merged.at(-1);
      if (tail && range[0] <= tail[1] + 0.0001) tail[1] = Math.max(tail[1], range[1]);
      else merged.push([...range]);
    }
    if (merged.length) removeRanges(draft, merged, true);
    return true;
  });
}

export function directCommandResult(plan, beforeProject, afterProject) {
  const before = getTimelineDuration(beforeProject);
  const after = getTimelineDuration(afterProject);
  const removed = Math.max(0, before - after);
  if (plan.actions.some((action) => action.type === 'remove_ranges')) {
    const action = plan.actions.find((item) => item.type === 'remove_ranges');
    return `Done. Removed ${action.ranges.length} silent section${action.ranges.length === 1 ? '' : 's'} (${removed.toFixed(1)} seconds total).`;
  }
  if (plan.actions.some((action) => action.type === 'remove_range' || action.type === 'trim_to_duration')) {
    return `Done. Timeline shortened by ${removed.toFixed(1)} seconds. All edits remain reversible.`;
  }
  const captions = plan.actions.find((action) => action.type === 'add_captions');
  if (captions) return `Done. Added ${captions.segments.length} locally transcribed captions to the timeline.`;
  const zooms = plan.actions.find((action) => action.type === 'add_speech_zooms');
  if (zooms) return `Done. Added ${zooms.segments.length} speech-linked zoom ranges as reversible keyframes.`;
  const ratio = plan.actions.find((action) => action.type === 'set_aspect_ratio');
  if (ratio) return `Done. Sequence is now ${ratio.ratio}; the original media is unchanged.`;
  const volume = plan.actions.find((action) => action.type === 'set_volume');
  if (volume) return `Done. Updated ${volume.multiplier < 1 ? 'lowered' : 'raised'} audio levels on the timeline.`;
  const split = plan.actions.find((action) => action.type === 'split_clip');
  if (split) return 'Done. Split the selected clip at the playhead.';
  const move = plan.actions.find((action) => action.type === 'move_clip');
  if (move) return 'Done. Moved the selected clip.';
  return `Done. Applied ${plan.actions.length} timeline change${plan.actions.length === 1 ? '' : 's'}.`;
}
