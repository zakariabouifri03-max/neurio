/**
 * Places transcribed caption lines on a "Captions" text track (shared by the captions tool and the AI director).
 */
import type { Clip } from '@/core/types';
import { useProject, usePlayback } from '@/core/store';
import * as cmd from '@/core/commands';
import { makeCaptionClip, makeTrack } from '@/core/defaults';
import type { CaptionStyleDef } from '@/library/captionStyles';
import { ensureFont } from '@/library/fonts';
import type { CaptionLine } from './captions';

export function placeLines(lines: (CaptionLine & { clipId: string })[], style: CaptionStyleDef, replace: boolean, seekToFirst = true) {
  if (style.style.fontFamily) void ensureFont(style.style.fontFamily);
  useProject.getState().apply('Auto captions', (p0) => {
    let p = p0;
    if (replace) p = cmd.removeClips(p, cmd.allClips(p).filter((c) => c.kind === 'caption').map((c) => c.id));
    let track = p.tracks.find((t) => t.kind === 'text' && t.name === 'Captions');
    if (!track) {
      track = makeTrack('text', 'Captions');
      p = { ...p, tracks: [track, ...p.tracks] };
    }
    const clips: Clip[] = lines.map((l) => {
      const start = Math.max(0, l.start);
      const c = makeCaptionClip({ trackId: track!.id, text: l.text, words: l.words.map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.max(0.05, w.end - start) })), start, duration: Math.max(0.3, l.end - l.start), style: style.style, caption: style.caption });
      if (style.animation) c.animation = { ...c.animation, ...style.animation } as any;
      return c;
    });
    // avoid overlaps on the track: shrink previous to next start
    clips.sort((a, b) => a.start - b.start);
    for (let i = 0; i < clips.length - 1; i++) if (clips[i].start + clips[i].duration > clips[i + 1].start) clips[i].duration = Math.max(0.2, clips[i + 1].start - clips[i].start - 0.01);
    return { ...p, tracks: p.tracks.map((t) => (t.id === track!.id ? { ...t, clips: cmd.sortClips([...t.clips, ...clips]) } : t)) };
  });
  const first = lines[0];
  if (first && seekToFirst) usePlayback.getState().seek(Math.max(0, first.start));
}

