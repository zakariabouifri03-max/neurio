/** Viral caption looks: text style + highlight behaviour. */
import type { TextStyle, CaptionStyle, TextAnimation } from '@/core/types';

export interface CaptionStyleDef {
  id: string;
  name: string;
  style: Partial<TextStyle>;
  caption: Partial<CaptionStyle>;
  animation?: Partial<TextAnimation>;
  sample: [string, string, string];
}

const pop: Partial<TextAnimation> = { in: { type: 'pop', duration: 0.15, unit: 'block', stagger: 0 }, out: { type: 'none', duration: 0, unit: 'block', stagger: 0 }, loop: null };
const none: Partial<TextAnimation> = { in: { type: 'none', duration: 0, unit: 'block', stagger: 0 }, out: { type: 'none', duration: 0, unit: 'block', stagger: 0 }, loop: null };

export const CAPTION_STYLES: CaptionStyleDef[] = [
  { id: 'hormozi', name: 'Bold yellow', style: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 72, color: '#ffffff', outline: { color: '#000000', width: 6 }, shadow: { color: 'rgba(0,0,0,0.6)', blur: 0, x: 3, y: 3 }, uppercase: true }, caption: { mode: 'word', highlightColor: '#ffe600', highlightBackground: null, highlightScale: 1.15, wordsPerLine: 3 }, animation: pop, sample: ['THIS', 'IS', 'VIRAL'] },
  { id: 'green_box', name: 'Green box', style: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 68, color: '#ffffff', outline: { color: '#000000', width: 5 }, shadow: null, uppercase: true }, caption: { mode: 'box', highlightColor: '#ffffff', highlightBackground: '#22c55e', highlightScale: 1.05, wordsPerLine: 3 }, animation: none, sample: ['MAKE', 'MONEY', 'ONLINE'] },
  { id: 'purple_box', name: 'Purple box', style: { fontFamily: 'Poppins', fontWeight: 800, fontSize: 64, color: '#ffffff', outline: { color: '#000000', width: 4 }, shadow: null }, caption: { mode: 'box', highlightColor: '#ffffff', highlightBackground: '#8b5cf6', highlightScale: 1.05, wordsPerLine: 4 }, animation: none, sample: ['Watch', 'this', 'now'] },
  { id: 'karaoke', name: 'Karaoke', style: { fontFamily: 'Inter', fontWeight: 800, fontSize: 60, color: '#d1d5db', outline: { color: '#000000', width: 4 }, shadow: null }, caption: { mode: 'karaoke', highlightColor: '#22d3ee', highlightBackground: null, highlightScale: 1, wordsPerLine: 5 }, animation: none, sample: ['Sing', 'along', 'now'] },
  { id: 'clean', name: 'Clean white', style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 56, color: '#ffffff', outline: null, shadow: { color: 'rgba(0,0,0,0.9)', blur: 14, x: 0, y: 3 } }, caption: { mode: 'word', highlightColor: '#ffffff', highlightBackground: null, highlightScale: 1.08, wordsPerLine: 5 }, animation: none, sample: ['Simple', 'and', 'clear'] },
  { id: 'podcast', name: 'Podcast', style: { fontFamily: 'Roboto', fontWeight: 500, fontSize: 52, color: '#ffffff', background: { color: 'rgba(0,0,0,0.7)', padding: 14, radius: 8 }, outline: null, shadow: null }, caption: { mode: 'word', highlightColor: '#f59e0b', highlightBackground: null, highlightScale: 1, wordsPerLine: 6 }, animation: none, sample: ['Let', 'me', 'explain'] },
  { id: 'neon', name: 'Neon', style: { fontFamily: 'Audiowide', fontWeight: 400, fontSize: 60, color: '#ffffff', glow: { color: '#22d3ee', blur: 24 }, outline: null, shadow: null }, caption: { mode: 'word', highlightColor: '#ff4fd8', highlightBackground: null, highlightScale: 1.1, wordsPerLine: 4 }, animation: pop, sample: ['Glow', 'up', 'now'] },
  { id: 'comic', name: 'Comic', style: { fontFamily: 'Bangers', fontWeight: 400, fontSize: 80, color: '#ffffff', outline: { color: '#000000', width: 6 }, shadow: { color: '#000', blur: 0, x: 5, y: 5 }, letterSpacing: 2 }, caption: { mode: 'word', highlightColor: '#ff3d00', highlightBackground: null, highlightScale: 1.2, wordsPerLine: 3 }, animation: pop, sample: ['BOOM', 'POW', 'WOW'] },
  { id: 'minimal_lower', name: 'Minimal', style: { fontFamily: 'Inter', fontWeight: 500, fontSize: 46, color: '#ffffff', outline: null, shadow: { color: 'rgba(0,0,0,0.8)', blur: 8, x: 0, y: 2 } }, caption: { mode: 'none', highlightColor: '#ffffff', highlightBackground: null, highlightScale: 1, wordsPerLine: 7 }, animation: none, sample: ['just', 'the', 'words'] },
  { id: 'red_alert', name: 'Red alert', style: { fontFamily: 'Anton', fontWeight: 400, fontSize: 78, color: '#ffffff', outline: { color: '#000000', width: 6 }, shadow: null, uppercase: true }, caption: { mode: 'word', highlightColor: '#ef4444', highlightBackground: null, highlightScale: 1.18, wordsPerLine: 3 }, animation: pop, sample: ['STOP', 'DOING', 'THIS'] },
];
