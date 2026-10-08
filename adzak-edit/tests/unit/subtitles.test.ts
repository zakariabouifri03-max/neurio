import { describe, it, expect } from 'vitest';
import {
  parseSrt,
  serializeSrt,
  parseVtt,
  serializeVtt,
  parseAss,
  serializeAss,
  parseSubtitles,
  detectSubtitleFormat,
  wrapSubtitleText,
  wordsToCues,
  offsetCues,
  scaleCues,
  secondsToSrtTimestamp,
  srtTimestampToSeconds,
  secondsToAssTimestamp,
} from '../../src/core/subtitles/codecs';
import { defaultSubtitleStyle } from '../../src/core/types/subtitles';

const SRT_SAMPLE = `1
00:00:01,000 --> 00:00:03,500
Hello, and welcome
to the show.

2
00:00:04,000 --> 00:00:05,000
Second line.
`;

const VTT_SAMPLE = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello from WebVTT

00:00:04.000 --> 00:00:05.000
Second cue
`;

describe('subtitles: SRT', () => {
  it('parses a standard file', () => {
    const doc = parseSrt(SRT_SAMPLE);
    expect(doc.cues.length).toBe(2);
    expect(doc.cues[0]!.start).toBeCloseTo(1);
    expect(doc.cues[0]!.end).toBeCloseTo(3.5);
    expect(doc.cues[0]!.text).toBe('Hello, and welcome\nto the show.');
  });

  it('round-trips', () => {
    const doc = parseSrt(SRT_SAMPLE);
    const reparsed = parseSrt(serializeSrt(doc));
    expect(reparsed.cues.length).toBe(2);
    expect(reparsed.cues[0]!.start).toBeCloseTo(1);
    expect(reparsed.cues[0]!.text).toBe(doc.cues[0]!.text);
  });

  it('tolerates CRLF, a BOM and stray blank lines', () => {
    const messy = `\uFEFF${SRT_SAMPLE.replace(/\n/g, '\r\n')}\n\n\n`;
    expect(parseSrt(messy).cues.length).toBe(2);
  });

  it('tolerates a period instead of a comma in the milliseconds', () => {
    const doc = parseSrt('1\n00:00:01.000 --> 00:00:02.000\nDot separator\n');
    expect(doc.cues.length).toBe(1);
    expect(doc.cues[0]!.start).toBeCloseTo(1);
  });

  it('strips inline HTML tags', () => {
    const doc = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n<i>Italic</i> and <b>bold</b>\n');
    expect(doc.cues[0]!.text).toBe('Italic and bold');
  });

  it('skips a block with no timing line', () => {
    const doc = parseSrt('NOTE this is a comment\n\n1\n00:00:01,000 --> 00:00:02,000\nReal cue\n');
    expect(doc.cues.length).toBe(1);
  });

  it('formats timestamps correctly', () => {
    expect(secondsToSrtTimestamp(3661.5)).toBe('01:01:01,500');
    expect(secondsToSrtTimestamp(0)).toBe('00:00:00,000');
    expect(srtTimestampToSeconds('01:01:01,500')).toBeCloseTo(3661.5);
  });

  it('never emits a negative timestamp', () => {
    expect(secondsToSrtTimestamp(-5)).toBe('00:00:00,000');
  });
});

describe('subtitles: WebVTT', () => {
  it('parses a standard file', () => {
    const doc = parseVtt(VTT_SAMPLE);
    expect(doc.cues.length).toBe(2);
    expect(doc.cues[0]!.text).toBe('Hello from WebVTT');
  });

  it('round-trips with a period separator', () => {
    const doc = parseVtt(VTT_SAMPLE);
    const text = serializeVtt(doc);
    expect(text.startsWith('WEBVTT')).toBe(true);
    expect(text).toContain('00:00:01.000 --> 00:00:03.500');
    expect(parseVtt(text).cues.length).toBe(2);
  });

  it('skips NOTE blocks', () => {
    const doc = parseVtt('WEBVTT\n\nNOTE\nThis is a comment\nspanning lines\n\n00:00:01.000 --> 00:00:02.000\nCue\n');
    expect(doc.cues.length).toBe(1);
  });
});

describe('subtitles: ASS', () => {
  it('serialises a valid ASS document', () => {
    const doc = parseSrt(SRT_SAMPLE);
    doc.style = { ...defaultSubtitleStyle(), fontName: 'Arial', fontSizePx: 60, outlineWidthPx: 4 };
    const ass = serializeAss(doc);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:03.50,Default');
    // ASS line breaks are \N, not newlines.
    expect(ass).toContain('Hello, and welcome\\Nto the show.');
  });

  it('converts colours to ASS &HAABBGGRR order', () => {
    const doc = parseSrt(SRT_SAMPLE);
    doc.style.primaryColor = '#ff0000';
    expect(serializeAss(doc)).toContain('&H000000FF');
  });

  it('parses an ASS document back', () => {
    const doc = parseSrt(SRT_SAMPLE);
    const ass = serializeAss(doc);
    const reparsed = parseAss(ass);
    expect(reparsed.cues.length).toBe(2);
    expect(reparsed.cues[0]!.start).toBeCloseTo(1);
    expect(reparsed.cues[0]!.text).toBe('Hello, and welcome\nto the show.');
  });

  it('uses centisecond timestamps', () => {
    expect(secondsToAssTimestamp(1.234)).toBe('0:00:01.23');
  });

  it('strips ASS override blocks on parse', () => {
    const doc = parseAss(
      '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}Bold{\\b0} text\n',
    );
    expect(doc.cues[0]!.text).toBe('Bold text');
  });
});

describe('subtitles: format detection', () => {
  it('detects from content', () => {
    expect(detectSubtitleFormat('WEBVTT\n\n')).toBe('vtt');
    expect(detectSubtitleFormat('[Script Info]\n')).toBe('ass');
    expect(detectSubtitleFormat('1\n00:00:01,000 --> 00:00:02,000\nHi\n')).toBe('srt');
  });

  it('detects from the filename', () => {
    expect(detectSubtitleFormat('whatever', 'movie.vtt')).toBe('vtt');
    expect(detectSubtitleFormat('whatever', 'movie.ass')).toBe('ass');
    expect(detectSubtitleFormat('whatever', 'movie.srt')).toBe('srt');
  });

  it('parseSubtitles picks the right codec', () => {
    expect(parseSubtitles(VTT_SAMPLE, 'x.vtt').format).toBe('vtt');
    expect(parseSubtitles(SRT_SAMPLE, 'x.srt').format).toBe('srt');
  });
});

describe('subtitles: line breaking', () => {
  it('leaves short text on one line', () => {
    expect(wrapSubtitleText('Short line', 42)).toEqual(['Short line']);
  });

  it('wraps long text into two balanced lines', () => {
    const lines = wrapSubtitleText(
      'This is a fairly long sentence that should be wrapped onto two lines by the wrapper',
      42,
    );
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(42);
  });

  it('respects the line limit', () => {
    const lines = wrapSubtitleText('one two three four five six seven eight nine ten eleven twelve', 12, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it('handles empty input', () => {
    expect(wrapSubtitleText('', 42)).toEqual([]);
    expect(wrapSubtitleText('   ', 42)).toEqual([]);
  });
});

describe('subtitles: word timings to cues', () => {
  const words = [
    { word: 'Hello', start: 0, end: 0.4 },
    { word: 'everyone', start: 0.4, end: 0.9 },
    { word: 'and', start: 0.9, end: 1.0 },
    { word: 'welcome', start: 1.0, end: 1.5 },
    { word: 'to', start: 1.5, end: 1.6 },
    { word: 'the', start: 1.6, end: 1.7 },
    { word: 'show.', start: 1.7, end: 2.1 },
    { word: 'Today', start: 2.4, end: 2.8 },
    { word: 'we', start: 2.8, end: 2.9 },
    { word: 'talk.', start: 2.9, end: 3.3 },
  ];

  it('segments by word count', () => {
    const cues = wordsToCues(words, { maxWords: 4, maxChars: 100 });
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) expect(cue.text.split(' ').length).toBeLessThanOrEqual(4);
  });

  it('segments by character count', () => {
    const cues = wordsToCues(words, { maxChars: 16, maxWords: 100 });
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(16);
  });

  it('breaks at sentence ends', () => {
    const cues = wordsToCues(words, { maxWords: 10, maxChars: 200 });
    expect(cues.some((c) => c.text.endsWith('show.'))).toBe(true);
  });

  it('never produces overlapping cues', () => {
    const cues = wordsToCues(words, { maxWords: 2, maxChars: 20 });
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end - 1e-6);
    }
  });

  it('keeps word timings for karaoke-style highlighting', () => {
    const cues = wordsToCues(words);
    expect(cues[0]!.words?.length).toBeGreaterThan(0);
  });

  it('handles an empty transcript', () => {
    expect(wordsToCues([])).toEqual([]);
  });
});

describe('subtitles: timing transforms', () => {
  it('offsets every cue', () => {
    const cues = parseSrt(SRT_SAMPLE).cues;
    const shifted = offsetCues(cues, 2);
    expect(shifted[0]!.start).toBeCloseTo(3);
    expect(shifted[1]!.start).toBeCloseTo(6);
  });

  it('never offsets below zero', () => {
    const cues = parseSrt(SRT_SAMPLE).cues;
    expect(offsetCues(cues, -10)[0]!.start).toBe(0);
  });

  it('scales timings for a speed change', () => {
    const cues = parseSrt(SRT_SAMPLE).cues;
    const scaled = scaleCues(cues, 0.5);
    expect(scaled[0]!.start).toBeCloseTo(0.5);
    expect(scaled[0]!.end).toBeCloseTo(1.75);
  });
});
