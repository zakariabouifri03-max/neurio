import type { Sequence } from '../types/timeline';
import type { SubtitleCue, SubtitleDocument, SubtitleFormat } from '../types/subtitles';
import { defaultSubtitleStyle } from '../types/subtitles';
import { serializeSubtitles } from './codecs';
import { uid } from '../timeline/factory';

/**
 * Timeline -> subtitle document.
 *
 * Subtitle clips live on the timeline like any other clip, so exporting them is
 * a projection back onto a cue list. The clips stay the source of truth; nothing
 * here mutates the sequence.
 */

export function cuesFromSequence(sequence: Sequence): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.kind !== 'subtitle') continue;
      const text = clip.text?.text.trim();
      if (!text) continue;
      cues.push({
        id: uid('cue'),
        start: clip.timeline.start,
        end: clip.timeline.start + clip.timeline.duration,
        text,
        words: clip.subtitle?.words,
        speaker: clip.subtitle?.speaker,
      });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

export interface SubtitleDocumentOptions {
  format?: SubtitleFormat;
  language?: string;
  referenceWidth?: number;
  referenceHeight?: number;
}

export function subtitleDocumentFromSequence(
  sequence: Sequence,
  options: SubtitleDocumentOptions = {},
): SubtitleDocument {
  return {
    format: options.format ?? 'srt',
    language: options.language ?? 'en',
    cues: cuesFromSequence(sequence),
    style: defaultSubtitleStyle(),
    referenceWidth: options.referenceWidth ?? 1920,
    referenceHeight: options.referenceHeight ?? 1080,
  };
}

/** The ASS script FFmpeg's `subtitles` filter burns in, or null when there is nothing to burn. */
export function burnInScriptFromSequence(
  sequence: Sequence,
  referenceWidth = 1920,
  referenceHeight = 1080,
): string | null {
  const cues = cuesFromSequence(sequence);
  if (cues.length === 0) return null;
  return serializeSubtitles({
    format: 'ass',
    language: 'en',
    cues,
    style: defaultSubtitleStyle(),
    referenceWidth,
    referenceHeight,
  });
}
