/** Word-level timing, present when the ASR model emits it. */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
  /** Per-style override, falls back to the document style. */
  style?: Partial<SubtitleStyle>;
  words?: WordTiming[];
  speaker?: string;
}

export interface SubtitleStyle {
  fontName: string;
  fontSizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** &HAABBGGRR in ASS, hex here. */
  primaryColor: string;
  outlineColor: string;
  outlineWidthPx: number;
  shadowOffsetPx: number;
  shadowColor: string;
  backColor: string;
  backOpacity: number;
  alignment: 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-center' | 'middle-center';
  /** Margin from the chosen edge, in px at the reference resolution. */
  marginV: number;
  marginL: number;
  marginR: number;
  uppercase: boolean;
  maxCharsPerLine: number;
  maxLines: number;
}

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export interface SubtitleDocument {
  format: SubtitleFormat;
  language: string;
  cues: SubtitleCue[];
  style: SubtitleStyle;
  /** Frame size the style was authored against (ASS is resolution-relative). */
  referenceWidth: number;
  referenceHeight: number;
}

export const defaultSubtitleStyle = (): SubtitleStyle => ({
  fontName: 'Inter',
  fontSizePx: 54,
  bold: true,
  italic: false,
  underline: false,
  primaryColor: '#ffffff',
  outlineColor: '#000000',
  outlineWidthPx: 3,
  shadowOffsetPx: 0,
  shadowColor: '#00000080',
  backColor: '#000000',
  backOpacity: 0,
  alignment: 'bottom-center',
  marginV: 72,
  marginL: 48,
  marginR: 48,
  uppercase: false,
  maxCharsPerLine: 42,
  maxLines: 2,
});
