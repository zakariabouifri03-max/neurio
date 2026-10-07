/** Built-in text style presets (style + optional animation). */
import type { TextStyle, TextAnimation } from '@/core/types';

export interface TextPreset {
  id: string;
  name: string;
  category: 'Social' | 'Titles' | 'Subtitles' | 'Neon' | 'Fun' | 'Minimal' | 'Cinematic';
  style: Partial<TextStyle>;
  animation?: Partial<TextAnimation>;
  sample?: string;
}

const anim = (inType: string, outType = inType, unit: TextAnimation['in']['unit'] = 'block', duration = 0.4): Partial<TextAnimation> => ({
  in: { type: inType, duration, unit, stagger: 0.04 },
  out: { type: outType, duration, unit, stagger: 0.04 },
});

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'tiktok_bold', name: 'TikTok Bold', category: 'Social', style: { fontFamily: 'Montserrat', fontWeight: 900, fontSize: 80, color: '#ffffff', outline: { color: '#000000', width: 6 }, shadow: null, uppercase: true }, animation: anim('pop', 'fade', 'word') },
  { id: 'hormozi', name: 'Impact Caption', category: 'Social', style: { fontFamily: 'Anton', fontSize: 86, color: '#ffe600', outline: { color: '#000000', width: 8 }, shadow: { color: 'rgba(0,0,0,0.7)', blur: 0, x: 4, y: 4 }, uppercase: true }, animation: anim('stamp', 'fade', 'word', 0.3) },
  { id: 'reels_box', name: 'Reels Box', category: 'Social', style: { fontFamily: 'Inter', fontWeight: 800, fontSize: 60, color: '#000000', background: { color: '#ffffff', padding: 18, radius: 12 }, shadow: null }, animation: anim('slideUp', 'fade', 'line') },
  { id: 'story_pill', name: 'Story Pill', category: 'Social', style: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 54, color: '#ffffff', background: { color: '#8b5cf6', padding: 20, radius: 40 }, shadow: null }, animation: anim('zoom') },
  { id: 'yt_title', name: 'YouTube Title', category: 'Titles', style: { fontFamily: 'Bebas Neue', fontSize: 140, color: '#ffffff', letterSpacing: 4, shadow: { color: 'rgba(0,0,0,0.8)', blur: 20, x: 0, y: 8 } }, animation: anim('slideUp', 'fade', 'char', 0.6) },
  { id: 'big_headline', name: 'Headline', category: 'Titles', style: { fontFamily: 'Archivo Black', fontSize: 110, color: '#ffffff', uppercase: true, lineHeight: 1.0, shadow: null }, animation: anim('tracking', 'fade', 'block', 0.7) },
  { id: 'gradient_title', name: 'Gradient', category: 'Titles', style: { fontFamily: 'Poppins', fontWeight: 900, fontSize: 120, color: '#ffffff', gradient: { from: '#8b5cf6', to: '#22d3ee', angle: 90 }, shadow: null }, animation: anim('blur', 'fade') },
  { id: 'lower_third', name: 'Lower third', category: 'Titles', style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 44, color: '#ffffff', align: 'left', background: { color: 'rgba(0,0,0,0.6)', padding: 16, radius: 6 }, shadow: null }, animation: anim('slideLeft', 'slideLeft', 'block', 0.4) },
  { id: 'sub_classic', name: 'Classic subtitle', category: 'Subtitles', style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 48, color: '#ffffff', outline: { color: '#000000', width: 3 }, shadow: { color: 'rgba(0,0,0,0.8)', blur: 6, x: 0, y: 2 } }, animation: anim('fade', 'fade', 'block', 0.15) },
  { id: 'sub_box', name: 'Boxed subtitle', category: 'Subtitles', style: { fontFamily: 'Roboto', fontWeight: 500, fontSize: 46, color: '#ffffff', background: { color: 'rgba(0,0,0,0.7)', padding: 12, radius: 4 }, shadow: null }, animation: anim('fade', 'fade', 'block', 0.1) },
  { id: 'sub_yellow', name: 'Yellow subtitle', category: 'Subtitles', style: { fontFamily: 'Open Sans', fontWeight: 700, fontSize: 48, color: '#ffeb3b', outline: { color: '#000000', width: 3 }, shadow: null }, animation: anim('fade', 'fade', 'block', 0.1) },
  { id: 'neon_pink', name: 'Neon pink', category: 'Neon', style: { fontFamily: 'Monoton', fontSize: 110, color: '#ff4fd8', glow: { color: '#ff4fd8', blur: 40 }, shadow: null }, animation: anim('neonFlicker', 'fade', 'block', 1) },
  { id: 'neon_cyan', name: 'Neon cyan', category: 'Neon', style: { fontFamily: 'Audiowide', fontSize: 100, color: '#22d3ee', glow: { color: '#22d3ee', blur: 36 }, outline: { color: '#ffffff', width: 1 }, shadow: null }, animation: anim('glitch', 'fade', 'char', 0.8) },
  { id: 'cyber', name: 'Cyberpunk', category: 'Neon', style: { fontFamily: 'Orbitron', fontWeight: 900, fontSize: 96, color: '#f5f500', outline: { color: '#00e5ff', width: 2 }, glow: { color: '#ff00aa', blur: 24 }, shadow: null, uppercase: true }, animation: anim('glitch', 'glitch', 'char', 0.7) },
  { id: 'comic', name: 'Comic', category: 'Fun', style: { fontFamily: 'Bangers', fontSize: 120, color: '#ffd600', outline: { color: '#000000', width: 8 }, shadow: { color: '#000000', blur: 0, x: 8, y: 8 }, letterSpacing: 3 }, animation: anim('bounce', 'shrink', 'char', 0.6) },
  { id: 'meme', name: 'Meme', category: 'Fun', style: { fontFamily: 'Impact', fontSize: 100, color: '#ffffff', outline: { color: '#000000', width: 6 }, shadow: null, uppercase: true }, animation: anim('none', 'none') },
  { id: 'handwritten', name: 'Handwritten', category: 'Fun', style: { fontFamily: 'Caveat', fontWeight: 700, fontSize: 110, color: '#ffffff', shadow: { color: 'rgba(0,0,0,0.5)', blur: 10, x: 2, y: 4 } }, animation: anim('typewriter', 'fade', 'char', 1.2) },
  { id: 'retro_game', name: 'Retro game', category: 'Fun', style: { fontFamily: 'Press Start 2P', fontSize: 56, color: '#7CFC00', shadow: { color: '#004400', blur: 0, x: 4, y: 4 }, lineHeight: 1.6 }, animation: anim('typewriter', 'blink', 'char', 1) },
  { id: 'minimal', name: 'Minimal', category: 'Minimal', style: { fontFamily: 'Inter', fontWeight: 300, fontSize: 72, color: '#ffffff', letterSpacing: 6, uppercase: true, shadow: null }, animation: anim('tracking', 'fade', 'block', 0.9) },
  { id: 'serif_elegant', name: 'Elegant serif', category: 'Minimal', style: { fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 96, color: '#ffffff', italic: true, shadow: null }, animation: anim('fade', 'fade', 'word', 0.8) },
  { id: 'mono_code', name: 'Code', category: 'Minimal', style: { fontFamily: 'JetBrains Mono', fontSize: 48, color: '#a6e3a1', background: { color: 'rgba(17,17,27,0.85)', padding: 24, radius: 10 }, align: 'left', shadow: null }, animation: anim('typewriter', 'fade', 'char', 1.5) },
  { id: 'cinematic', name: 'Cinematic', category: 'Cinematic', style: { fontFamily: 'Cinzel', fontWeight: 700, fontSize: 90, color: '#e8dcc0', letterSpacing: 10, uppercase: true, shadow: { color: 'rgba(0,0,0,0.9)', blur: 30, x: 0, y: 6 } }, animation: anim('blur', 'blur', 'block', 1.4) },
  { id: 'trailer', name: 'Trailer', category: 'Cinematic', style: { fontFamily: 'Oswald', fontWeight: 700, fontSize: 120, color: '#ffffff', letterSpacing: 14, uppercase: true, shadow: null }, animation: anim('tracking', 'blur', 'block', 1.2) },
  { id: 'horror', name: 'Horror', category: 'Cinematic', style: { fontFamily: 'Creepster', fontSize: 130, color: '#b00020', glow: { color: '#ff0000', blur: 20 }, shadow: null }, animation: anim('shrink', 'fade', 'block', 1) },
];
export const TEXT_PRESET_CATEGORIES: TextPreset['category'][] = ['Social', 'Subtitles', 'Titles', 'Neon', 'Fun', 'Minimal', 'Cinematic'];
export const getTextPreset = (id: string) => TEXT_PRESETS.find((p) => p.id === id);
