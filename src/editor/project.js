export const PROJECT_SCHEMA = 1;
export const EPSILON = 0.0001;

export function makeId(prefix = 'id') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
}

export function createProject(name = 'Untitled Project') {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA,
    id: makeId('project'),
    name,
    createdAt: now,
    updatedAt: now,
    settings: { width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', background: '#080b11' },
    assets: [],
    tracks: [
      { id: 'track-video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, visible: true },
      { id: 'track-audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, visible: true },
      { id: 'track-captions-1', name: 'Captions', type: 'caption', clips: [], muted: false, locked: false, visible: true },
    ],
    analysis: { byAsset: {} },
    conversation: [],
    versions: [],
  };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function validateProject(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.assets) || !Array.isArray(value.tracks)) {
    throw new Error('This is not a valid .nexusvideo project file.');
  }
  if (!value.settings || !Number.isFinite(Number(value.settings.width)) || !Number.isFinite(Number(value.settings.height))) {
    throw new Error('Project settings are missing or invalid.');
  }
  const ids = new Set(value.assets.map((asset) => asset.id));
  for (const track of value.tracks) {
    if (!Array.isArray(track.clips)) throw new Error(`Track “${track.name ?? 'unnamed'}” has an invalid clip list.`);
    for (const clip of track.clips) {
      if (!Number.isFinite(Number(clip.startTime)) || !Number.isFinite(Number(clip.duration)) || Number(clip.duration) <= 0) {
        throw new Error(`A clip on “${track.name ?? 'unnamed'}” has invalid timing.`);
      }
      if (track.type !== 'caption' && !ids.has(clip.assetId)) {
        throw new Error(`A clip on “${track.name ?? 'unnamed'}” refers to a missing media asset.`);
      }
    }
  }
  return value;
}

export function getTimelineDuration(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.startTime + clip.duration);
  }
  return end;
}

export function getAllClips(project, type = null) {
  return project.tracks
    .filter((track) => !type || track.type === type)
    .flatMap((track) => track.clips.map((clip) => ({ ...clip, trackId: track.id, trackType: track.type, trackName: track.name })));
}

export function getClipById(project, clipId) {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

export function getAssetById(project, assetId) {
  return project.assets.find((asset) => asset.id === assetId) ?? null;
}

export function ensureTrack(project, type, name) {
  let track = project.tracks.find((candidate) => candidate.type === type);
  if (!track) {
    track = { id: makeId(`track-${type}`), name, type, clips: [], muted: false, locked: false, visible: true };
    project.tracks.push(track);
  }
  return track;
}

export function addMediaAsset(project, asset, addToTimeline = false) {
  if (project.assets.some((item) => item.id === asset.id)) return null;
  const normalized = {
    id: asset.id ?? makeId('asset'),
    name: asset.name ?? 'Untitled media',
    path: asset.path ?? null,
    storageKey: asset.storageKey ?? null,
    mediaType: asset.mediaType ?? 'video',
    duration: Math.max(0, Number(asset.duration) || 0),
    width: Number(asset.width) || 0,
    height: Number(asset.height) || 0,
    fps: Number(asset.fps) || 0,
    hasAudio: Boolean(asset.hasAudio),
    size: Number(asset.size) || 0,
    importedAt: new Date().toISOString(),
    missing: false,
  };
  project.assets.push(normalized);
  if (addToTimeline && normalized.duration > 0 && normalized.mediaType !== 'image') {
    addAssetToTimeline(project, normalized.id);
  }
  return normalized;
}

export function addAssetToTimeline(project, assetId, startTime = null, trackId = null) {
  const asset = getAssetById(project, assetId);
  if (!asset || (asset.mediaType !== 'image' && asset.duration <= 0)) return null;
  const type = asset.mediaType === 'audio' ? 'audio' : 'video';
  const track = trackId ? project.tracks.find((item) => item.id === trackId) : ensureTrack(project, type, type === 'video' ? 'Video 1' : 'Audio 1');
  if (!track || track.type !== type || track.locked) return null;
  const end = track.clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0);
  const clipDuration = asset.mediaType === 'image' ? 5 : asset.duration;
  const clip = {
    id: makeId('clip'), assetId: asset.id, startTime: Math.max(0, startTime ?? end),
    sourceIn: 0, sourceOut: clipDuration, duration: clipDuration,
    volume: 1, transform: { scale: 1, x: 0.5, y: 0.5, fit: 'cover' },
    effects: [], keyframes: [],
  };
  track.clips.push(clip);
  sortTrack(track);
  return clip;
}

export function sortTrack(track) {
  track.clips.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
}

function pieceFrom(clip, timelineStart, sourceOffset, duration, newId = false) {
  const copy = { ...clip, transform: { ...(clip.transform ?? {}) }, effects: [...(clip.effects ?? [])], keyframes: [...(clip.keyframes ?? [])] };
  if (newId) copy.id = makeId('clip');
  copy.startTime = Math.max(0, timelineStart);
  copy.duration = duration;
  if (Number.isFinite(clip.sourceIn)) {
    copy.sourceIn = clip.sourceIn + sourceOffset;
    copy.sourceOut = copy.sourceIn + duration;
  }
  copy.keyframes = copy.keyframes
    .filter((keyframe) => keyframe.time >= sourceOffset - EPSILON && keyframe.time <= sourceOffset + duration + EPSILON)
    .map((keyframe) => ({ ...keyframe, time: keyframe.time - sourceOffset }));
  return copy;
}

/** Removes a timeline interval. By default, all later media ripples left. */
export function removeTimelineRange(project, start, end, ripple = true) {
  const from = Math.max(0, Number(start) || 0);
  const to = Math.max(from, Number(end) || 0);
  const length = to - from;
  if (length <= EPSILON) return 0;
  let changed = 0;
  for (const track of project.tracks) {
    if (track.locked) continue;
    const next = [];
    for (const clip of track.clips) {
      const clipStart = clip.startTime;
      const clipEnd = clipStart + clip.duration;
      if (clipEnd <= from + EPSILON) {
        next.push(clip);
        continue;
      }
      if (clipStart >= to - EPSILON) {
        const copy = { ...clip, startTime: ripple ? Math.max(0, clipStart - length) : clipStart };
        next.push(copy);
        if (ripple) changed++;
        continue;
      }
      const beforeDuration = Math.max(0, Math.min(clipEnd, from) - clipStart);
      const afterStart = Math.max(clipStart, to);
      const afterDuration = Math.max(0, clipEnd - afterStart);
      if (beforeDuration > EPSILON) next.push(pieceFrom(clip, clipStart, 0, beforeDuration));
      if (afterDuration > EPSILON) {
        const offset = afterStart - clipStart;
        const targetStart = ripple ? Math.max(0, afterStart - length) : afterStart;
        next.push(pieceFrom(clip, targetStart, offset, afterDuration, beforeDuration > EPSILON));
      }
      changed++;
    }
    track.clips = next;
    sortTrack(track);
  }
  return changed;
}

export function removeRanges(project, ranges, ripple = true) {
  const sorted = [...ranges].filter(([start, end]) => end > start).sort((a, b) => b[0] - a[0]);
  let removed = 0;
  for (const [start, end] of sorted) removed += removeTimelineRange(project, start, end, ripple);
  return removed;
}

export function trimToDuration(project, duration) {
  const limit = Math.max(0, Number(duration) || 0);
  const current = getTimelineDuration(project);
  if (current > limit + EPSILON) removeTimelineRange(project, limit, current + EPSILON, true);
  return Math.max(0, current - limit);
}

export function splitClip(project, clipId, atTime) {
  const found = getClipById(project, clipId);
  if (!found || found.track.locked) return null;
  const { clip, track } = found;
  const splitAt = Number(atTime);
  const local = splitAt - clip.startTime;
  if (!(local > EPSILON && local < clip.duration - EPSILON)) return null;
  const left = pieceFrom(clip, clip.startTime, 0, local);
  const right = pieceFrom(clip, splitAt, local, clip.duration - local, true);
  const index = track.clips.findIndex((item) => item.id === clipId);
  track.clips.splice(index, 1, left, right);
  sortTrack(track);
  return { left, right };
}

export function moveClip(project, clipId, startTime) {
  const found = getClipById(project, clipId);
  if (!found || found.track.locked) return false;
  found.clip.startTime = Math.max(0, Number(startTime) || 0);
  sortTrack(found.track);
  return true;
}

export function setAspectRatio(project, ratio) {
  const dimensions = {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350],
  };
  const size = dimensions[ratio];
  if (!size) throw new Error(`Unsupported aspect ratio: ${ratio}`);
  project.settings.width = size[0];
  project.settings.height = size[1];
  project.settings.aspectRatio = ratio;
  for (const track of project.tracks.filter((item) => item.type === 'video')) {
    for (const clip of track.clips) clip.transform = { ...(clip.transform ?? {}), fit: 'cover' };
  }
}

export function adjustProjectVolume(project, multiplier, trackType = null) {
  const ratio = Math.max(0, Math.min(4, Number(multiplier) || 1));
  const audioAssets = new Set(project.assets.filter((asset) => asset.hasAudio).map((asset) => asset.id));
  let count = 0;
  for (const track of project.tracks) {
    if (track.locked || (trackType && track.type !== trackType)) continue;
    for (const clip of track.clips) {
      const hasAudio = track.type === 'audio' || (track.type === 'video' && audioAssets.has(clip.assetId));
      if (!hasAudio) continue;
      clip.volume = Math.max(0, Math.min(4, (Number(clip.volume) || 1) * ratio));
      count++;
    }
  }
  return count;
}

export function normalizeProjectAudio(project) {
  let count = 0;
  const audioAssets = new Set(project.assets.filter((asset) => asset.hasAudio).map((asset) => asset.id));
  for (const track of project.tracks) {
    if (track.locked || !['audio', 'video'].includes(track.type)) continue;
    for (const clip of track.clips) {
      if (track.type === 'audio' || audioAssets.has(clip.assetId)) {
        clip.effects = [...(clip.effects ?? []).filter((effect) => effect.type !== 'normalize'), { type: 'normalize' }];
        count++;
      }
    }
  }
  return count;
}

export function addCaptionSegments(project, segments, style = {}) {
  const track = ensureTrack(project, 'caption', 'Captions');
  if (track.locked) throw new Error('The captions track is locked.');
  const added = [];
  for (const segment of segments) {
    const startTime = Math.max(0, Number(segment.startTime ?? segment.start) || 0);
    const endTime = Math.max(startTime, Number(segment.endTime ?? segment.end) || 0);
    const text = String(segment.text ?? '').trim();
    if (!text || endTime - startTime < 0.02) continue;
    const clip = {
      id: makeId('caption'), startTime, duration: endTime - startTime,
      text, style: { ...style },
      emphasis: Array.isArray(segment.emphasis) ? segment.emphasis : [],
    };
    track.clips.push(clip);
    added.push(clip);
  }
  sortTrack(track);
  return added;
}

export function addSpeechZooms(project, segments, zoom = 1.12) {
  let count = 0;
  for (const track of project.tracks.filter((item) => item.type === 'video' && !item.locked)) {
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration;
      const keyframes = [...(clip.keyframes ?? [])];
      for (const segment of segments) {
        const from = Math.max(clip.startTime, Number(segment.startTime ?? segment.start) || 0);
        const to = Math.min(clipEnd, Number(segment.endTime ?? segment.end) || 0);
        if (to - from < 0.05) continue;
        const inPoint = from - clip.startTime;
        const outPoint = to - clip.startTime;
        keyframes.push({ time: inPoint, property: 'scale', value: zoom, easing: 'ease-in' });
        keyframes.push({ time: Math.max(inPoint, outPoint - 0.12), property: 'scale', value: zoom, easing: 'linear' });
        keyframes.push({ time: outPoint, property: 'scale', value: 1, easing: 'ease-out' });
        count++;
      }
      clip.keyframes = keyframes.sort((a, b) => a.time - b.time);
    }
  }
  return count;
}

export function addEffect(project, effectType, value = {}) {
  let count = 0;
  for (const track of project.tracks) {
    if (track.locked || !['video', 'audio'].includes(track.type)) continue;
    for (const clip of track.clips) {
      clip.effects = [...(clip.effects ?? []).filter((effect) => effect.type !== effectType), { type: effectType, ...value }];
      count++;
    }
  }
  return count;
}

export function captionAt(project, time) {
  const track = project.tracks.find((item) => item.type === 'caption' && !item.muted && item.visible !== false);
  if (!track) return null;
  return track.clips.find((clip) => time >= clip.startTime && time < clip.startTime + clip.duration) ?? null;
}

export function toProjectFile(project) {
  const copy = cloneProject(project);
  // Asset binaries are kept outside the project; paths/IDs are references only.
  copy.schemaVersion = PROJECT_SCHEMA;
  return copy;
}
