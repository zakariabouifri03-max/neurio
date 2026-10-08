import type { SubtitleCue, SubtitleDocument, SubtitleStyle } from '../types/subtitles';
import { defaultSubtitleStyle } from '../types/subtitles';
import { clamp } from '../types/time';

/**
 * Subtitle codecs: SRT, WebVTT and ASS.
 *
 * Parsing is deliberately tolerant — real-world files are messy (BOM, CRLF,
 * comma/period decimal separators, stray blank lines, HTML tags). Serialising is
 * strict.
 */

export function srtTimestampToSeconds(value: string): number {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(value.trim());
  if (!m) return Number.NaN;
  const [, h, min, s, ms] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms!.padEnd(3, '0')) / 1000;
}

function pad(value: number, len: number): string {
  return String(Math.floor(value)).padStart(len, '0');
}

export function secondsToSrtTimestamp(seconds: number, separator = ','): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(ms, 3)}`;
}

/** ASS uses centiseconds and an H:MM:SS.cc format. */
export function secondsToAssTimestamp(seconds: number): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${pad(h, 1)}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

export function assTimestampToSeconds(value: string): number {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[.](\d{1,2})/.exec(value.trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
}

const TAG_RE = /<[^>]*>/g;

function stripInlineTags(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(TAG_RE, '')
    .replace(/\{\\[^}]*\}/g, '') // ASS override blocks
    .replace(/\{[^}]*\}/g, '')
    .trim();
}

export function parseSrt(content: string, style?: SubtitleStyle): SubtitleDocument {
  const clean = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = clean.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;
    // Line 1 may be the index; find the timing line wherever it is.
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;
    const [startRaw, endRaw] = lines[timingIdx]!.split('-->');
    const start = srtTimestampToSeconds(startRaw ?? '');
    const end = srtTimestampToSeconds(endRaw ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = stripInlineTags(lines.slice(timingIdx + 1).join('\n'));
    if (!text) continue;
    cues.push({ id: `cue_${cues.length + 1}`, start, end: Math.max(end, start + 0.04), text });
  }

  return {
    format: 'srt',
    language: 'en',
    cues: cues.sort((a, b) => a.start - b.start),
    style: style ?? defaultSubtitleStyle(),
    referenceWidth: 1920,
    referenceHeight: 1080,
  };
}

export function serializeSrt(doc: SubtitleDocument): string {
  return doc.cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((cue, i) => {
      const text = cue.style?.uppercase ? cue.text.toUpperCase() : cue.text;
      return `${i + 1}\n${secondsToSrtTimestamp(cue.start)} --> ${secondsToSrtTimestamp(cue.end)}\n${text}\n`;
    })
    .join('\n');
}

export function parseVtt(content: string, style?: SubtitleStyle): SubtitleDocument {
  const clean = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  const lines = clean.split('\n');
  let i = 0;
  // Skip the WEBVTT header and any NOTE blocks.
  while (i < lines.length && !lines[i]!.includes('-->')) {
    if (lines[i]!.trim().startsWith('NOTE')) {
      while (i < lines.length && lines[i]!.trim() !== '') i++;
    }
    i++;
  }
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.includes('-->')) {
      const [startRaw, endRaw] = line.split('-->');
      const start = srtTimestampToSeconds((startRaw ?? '').trim().replace(/\s.*$/, ''));
      const end = srtTimestampToSeconds((endRaw ?? '').trim().split(/\s/)[0] ?? '');
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '') {
        textLines.push(lines[i]!);
        i++;
      }
      const text = stripInlineTags(textLines.join('\n'));
      if (Number.isFinite(start) && Number.isFinite(end) && text) {
        cues.push({ id: `cue_${cues.length + 1}`, start, end: Math.max(end, start + 0.04), text });
      }
    }
    i++;
  }
  return {
    format: 'vtt',
    language: 'en',
    cues: cues.sort((a, b) => a.start - b.start),
    style: style ?? defaultSubtitleStyle(),
    referenceWidth: 1920,
    referenceHeight: 1080,
  };
}

export function serializeVtt(doc: SubtitleDocument): string {
  const body = doc.cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((cue) => {
      const text = cue.style?.uppercase ? cue.text.toUpperCase() : cue.text;
      return `${secondsToSrtTimestamp(cue.start, '.')} --> ${secondsToSrtTimestamp(cue.end, '.')}\n${text}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/* ---------------------------- ASS ---------------------------- */

const ASS_ALIGNMENT: Record<SubtitleStyle['alignment'], number> = {
  'bottom-left': 1,
  'bottom-center': 2,
  'bottom-right': 3,
  'middle-center': 5,
  'top-center': 8,
};

/** ASS colours are &HAABBGGRR. */
export function hexToAssColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return '&H00FFFFFF';
  const rgb = m[1]!;
  const a = m[2] ?? pad(alpha, 2);
  const rr = rgb.slice(0, 2);
  const gg = rgb.slice(2, 4);
  const bb = rgb.slice(4, 6);
  return `&H${a}${bb}${gg}${rr}`.toUpperCase();
}

export function serializeAss(doc: SubtitleDocument): string {
  const s = doc.style;
  const header = `[Script Info]
; Generated by ADZAK EDIT
ScriptType: v4.00+
PlayResX: ${doc.referenceWidth}
PlayResY: ${doc.referenceHeight}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontName},${s.fontSizePx},${hexToAssColor(s.primaryColor)},${hexToAssColor(s.primaryColor)},${hexToAssColor(
    s.outlineColor,
  )},${hexToAssColor(s.backColor, Math.round((1 - s.backOpacity) * 255))},${s.bold ? -1 : 0},${s.italic ? -1 : 0},${
    s.underline ? -1 : 0
  },0,100,100,0,0,${s.backOpacity > 0 ? 3 : 1},${s.outlineWidthPx},${s.shadowOffsetPx},${ASS_ALIGNMENT[s.alignment]},${
    s.marginL
  },${s.marginR},${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = doc.cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((cue) => {
      const text = (cue.style?.uppercase ? cue.text.toUpperCase() : cue.text)
        .replace(/\r?\n/g, '\\N')
        .replace(/\{|\}/g, '');
      return `Dialogue: 0,${secondsToAssTimestamp(cue.start)},${secondsToAssTimestamp(cue.end)},Default,,0,0,0,,${text}`;
    });

  return `${header}\n${events.join('\n')}\n`;
}

export function parseAss(content: string): SubtitleDocument {
  const clean = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  let style = defaultSubtitleStyle();
  for (const line of clean.split('\n')) {
    if (line.startsWith('Dialogue:')) {
      const parts = line.slice('Dialogue:'.length).split(',');
      if (parts.length < 10) continue;
      const start = assTimestampToSeconds(parts[1] ?? '');
      const end = assTimestampToSeconds(parts[2] ?? '');
      const text = stripInlineTags(parts.slice(9).join(',')).replace(/\\N/gi, '\n');
      if (Number.isFinite(start) && Number.isFinite(end) && text) {
        cues.push({ id: `cue_${cues.length + 1}`, start, end, text });
      }
    } else if (line.startsWith('PlayResX:')) {
      style = { ...style };
    } else if (line.startsWith('Style:') && line.includes('Default')) {
      const cols = line.slice('Style:'.length).split(',');
      if (cols.length >= 24) {
        style = {
          ...style,
          fontName: cols[1] ?? style.fontName,
          fontSizePx: Number(cols[2]) || style.fontSizePx,
          bold: cols[7] === '-1',
          italic: cols[8] === '-1',
          outlineWidthPx: Number(cols[16]) || style.outlineWidthPx,
          shadowOffsetPx: Number(cols[17]) || style.shadowOffsetPx,
          marginL: Number(cols[19]) || style.marginL,
          marginR: Number(cols[20]) || style.marginR,
          marginV: Number(cols[21]) || style.marginV,
        };
      }
    }
  }
  return {
    format: 'ass',
    language: 'en',
    cues: cues.sort((a, b) => a.start - b.start),
    style,
    referenceWidth: 1920,
    referenceHeight: 1080,
  };
}

export function detectSubtitleFormat(content: string, filename?: string): SubtitleDocument['format'] {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (ext === 'vtt') return 'vtt';
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  if (ext === 'srt') return 'srt';
  if (/^\uFEFF?WEBVTT/i.test(content)) return 'vtt';
  if (content.includes('[Script Info]')) return 'ass';
  return 'srt';
}

export function parseSubtitles(content: string, filename?: string): SubtitleDocument {
  const format = detectSubtitleFormat(content, filename);
  if (format === 'vtt') return parseVtt(content);
  if (format === 'ass') return parseAss(content);
  return parseSrt(content);
}

export function serializeSubtitles(doc: SubtitleDocument): string {
  if (doc.format === 'vtt') return serializeVtt(doc);
  if (doc.format === 'ass') return serializeAss(doc);
  return serializeSrt(doc);
}

/* ---------------------- line breaking ---------------------- */

/**
 * Wrap transcript text into subtitle-friendly lines.
 *
 * Greedy word wrap on `maxCharsPerLine`, then a second pass that balances the
 * two lines so captions do not look lopsided. Punctuation is never left
 * stranded at the start of a line.
 */
export function wrapSubtitleText(
  text: string,
  maxCharsPerLine: number,
  maxLines = 2,
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  if (maxLines <= 1 || text.length <= maxCharsPerLine) return [text.trim()];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        // Everything remaining goes on the last line.
        const rest = words.slice(words.indexOf(word)).join(' ');
        lines.push(rest);
        return balance(lines);
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return balance(lines.filter((l) => l.trim().length > 0));
}

function balance(lines: string[]): string[] {
  if (lines.length !== 2) return lines.map((l) => l.trim());
  const [a, b] = lines as [string, string];
  // Move trailing words up when the split is very lopsided.
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  while (wordsA.length > 1 && Math.abs(wordsA.length - wordsB.length) > 1) {
    wordsB.unshift(wordsA.pop()!);
  }
  return [wordsA.join(' ').trim(), wordsB.join(' ').trim()].filter(Boolean);
}

/**
 * Turn word timings into cues of at most `maxWords` words / `maxChars` chars,
 * never longer than `maxDurationSec`. This is the auto-caption segmentation
 * step between Whisper output and editable subtitle clips.
 */
export interface CaptionSegmentOptions {
  maxWords: number;
  maxChars: number;
  maxDurationSec: number;
  /** Split preferentially at these words. */
  breakWords?: string[];
}

export const DEFAULT_CAPTION_OPTIONS: CaptionSegmentOptions = {
  maxWords: 8,
  maxChars: 42,
  maxDurationSec: 5,
  breakWords: ['.', '!', '?', ',', ';', ':'],
};

export function wordsToCues(
  words: { word: string; start: number; end: number }[],
  options: Partial<CaptionSegmentOptions> = {},
): SubtitleCue[] {
  const opts = { ...DEFAULT_CAPTION_OPTIONS, ...options };
  const cues: SubtitleCue[] = [];
  let buffer: typeof words = [];

  const flush = () => {
    if (!buffer.length) return;
    const first = buffer[0]!;
    const last = buffer[buffer.length - 1]!;
    const text = buffer.map((w) => w.word).join(' ').replace(/\s+([.,!?;:])/g, '$1').trim();
    if (text) {
      cues.push({
        id: `cue_${cues.length + 1}`,
        start: first.start,
        end: Math.max(last.end, first.start + 0.5),
        text,
        words: buffer.map((w) => ({ word: w.word, start: w.start, end: w.end })),
      });
    }
    buffer = [];
  };

  for (const word of words) {
    const projected = [...buffer, word].map((w) => w.word).join(' ');
    const tooLong =
      buffer.length >= opts.maxWords ||
      projected.length > opts.maxChars ||
      (buffer.length > 0 && word.end - buffer[0]!.start > opts.maxDurationSec);
    if (tooLong) flush();
    buffer.push(word);
    const endsSentence = opts.breakWords?.some((b) => word.word.endsWith(b)) ?? false;
    if (endsSentence && buffer.length >= Math.max(2, Math.floor(opts.maxWords / 2))) flush();
  }
  flush();

  // De-overlap consecutive cues so the renderer never shows two at once.
  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1]!;
    const cur = cues[i]!;
    if (cur.start < prev.end) prev.end = clamp(cur.start, prev.start + 0.1, cur.start);
  }
  return cues;
}

/** Shift every cue by a constant offset (fixing ASR drift). */
export function offsetCues(cues: SubtitleCue[], deltaSec: number): SubtitleCue[] {
  return cues.map((c) => ({ ...c, start: Math.max(0, c.start + deltaSec), end: Math.max(0, c.end + deltaSec) }));
}

/** Scale timings by a factor, e.g. after changing a clip's speed. */
export function scaleCues(cues: SubtitleCue[], factor: number, anchorSec = 0): SubtitleCue[] {
  if (factor === 1) return cues;
  return cues.map((c) => ({
    ...c,
    start: anchorSec + (c.start - anchorSec) * factor,
    end: anchorSec + (c.end - anchorSec) * factor,
  }));
}
