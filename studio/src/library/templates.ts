/**
 * Template registry. A template is a declarative project blueprint with slots: media slots are filled
 * with the user's media (or a labelled placeholder), text slots are editable text clips, music slots
 * reference the generative music library. Everything stays fully editable after creation.
 */
import type { Project, Clip, TextStyle, TextAnimation, MediaAsset, TrackKind } from '@/core/types';
import { makeProject, makeTrack, makeVideoClip, makeImageClip, makeColorClip, makeTextClip, makeStickerClip, makeAudioClip, SOCIAL_PRESETS } from '@/core/defaults';
import { uid } from '@/core/util';

export type TemplateCategory = 'TikTok' | 'Reels' | 'Shorts' | 'YouTube' | 'Intro' | 'Outro' | 'Vlog' | 'Gaming' | 'Business' | 'Education' | 'Promo' | 'Meme' | 'Slideshow' | 'Captions' | 'Travel' | 'Music' | 'Fitness' | 'Food';

export interface TemplateTheme {
  primary: string;
  secondary: string;
  text: string;
  font: string;
  headingFont: string;
}
interface SlotBase {
  start: number;
  duration: number;
  track?: number; // index into layout tracks (0 = top)
  transitionOut?: { type: string; duration: number };
  effects?: string[];
  scale?: number;
  position?: { x: number; y: number };
}
export type TemplateSlot =
  | (SlotBase & { kind: 'media'; label: string; kenBurns?: boolean })
  | (SlotBase & { kind: 'text'; text: string; style: (t: TemplateTheme) => Partial<TextStyle>; animation?: Partial<TextAnimation> })
  | (SlotBase & { kind: 'color'; color: (t: TemplateTheme) => string })
  | (SlotBase & { kind: 'sticker'; stickerId: string; animation?: string | null })
  | { kind: 'music'; musicId: string; volume?: number };

export interface TemplateDef {
  id: string;
  name: string;
  category: TemplateCategory;
  presetId: string; // SOCIAL_PRESETS id → canvas size
  duration: number;
  description: string;
  tags: string[];
  theme: TemplateTheme;
  /** track kinds from top to bottom */
  layout: TrackKind[];
  slots: TemplateSlot[];
  /** gradient used for the catalogue card */
  cover: string;
}

const A = (inType: string, outType = 'fade', unit: TextAnimation['in']['unit'] = 'word', duration = 0.5): Partial<TextAnimation> => ({ in: { type: inType, duration, unit, stagger: 0.05 }, out: { type: outType, duration: 0.35, unit: 'block', stagger: 0 } });
const title = (t: TemplateTheme, size = 100, extra: Partial<TextStyle> = {}): Partial<TextStyle> => ({ fontFamily: t.headingFont, fontWeight: 900, fontSize: size, color: t.text, outline: { color: '#000000', width: 0 }, shadow: { color: 'rgba(0,0,0,0.6)', blur: 24, x: 0, y: 8 }, ...extra });
const caption = (t: TemplateTheme, size = 64): Partial<TextStyle> => ({ fontFamily: t.font, fontWeight: 800, fontSize: size, color: '#ffffff', outline: { color: '#000000', width: 6 }, uppercase: true, shadow: null });
const pill = (t: TemplateTheme, size = 54): Partial<TextStyle> => ({ fontFamily: t.font, fontWeight: 700, fontSize: size, color: '#ffffff', background: { color: t.primary, padding: 18, radius: 40 }, shadow: null });

const THEMES = {
  violet: { primary: '#8b5cf6', secondary: '#22d3ee', text: '#ffffff', font: 'Inter', headingFont: 'Poppins' },
  sunset: { primary: '#f97316', secondary: '#ec4899', text: '#ffffff', font: 'Poppins', headingFont: 'Bebas Neue' },
  neon: { primary: '#22c55e', secondary: '#a855f7', text: '#ffffff', font: 'Montserrat', headingFont: 'Anton' },
  clean: { primary: '#111827', secondary: '#f3f4f6', text: '#ffffff', font: 'Inter', headingFont: 'Archivo Black' },
  gold: { primary: '#d4a017', secondary: '#111111', text: '#ffffff', font: 'Playfair Display', headingFont: 'Playfair Display' },
  ocean: { primary: '#0ea5e9', secondary: '#1e3a8a', text: '#ffffff', font: 'Poppins', headingFont: 'Montserrat' },
  red: { primary: '#ef4444', secondary: '#111111', text: '#ffffff', font: 'Montserrat', headingFont: 'Anton' },
};

const slides = (n: number, each: number, startAt = 0, transition = 'fade', kenBurns = true): TemplateSlot[] => Array.from({ length: n }, (_, i) => ({ kind: 'media' as const, label: `Clip ${i + 1}`, start: startAt + i * each, duration: each, kenBurns, transitionOut: i < n - 1 ? { type: transition, duration: 0.5 } : undefined }));

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'tt_hook', name: 'Viral Hook', category: 'TikTok', presetId: 'tiktok', duration: 15, description: 'Attention-grabbing opener with big bold caption, 3 quick cuts and a CTA.', tags: ['viral', 'hook', 'caption', 'fast'], theme: THEMES.violet, layout: ['text', 'sticker', 'video', 'audio'], cover: 'linear-gradient(135deg,#8b5cf6,#22d3ee)',
    slots: [
      ...slides(3, 5, 0, 'zoomin', false),
      { kind: 'text', text: 'WAIT FOR IT…', start: 0, duration: 2.5, style: (t) => caption(t, 92), animation: A('pop', 'fade', 'word', 0.3), track: 0 },
      { kind: 'text', text: 'Nobody tells you this', start: 2.6, duration: 4, style: (t) => caption(t, 76), animation: A('slideUp', 'fade', 'word', 0.3), track: 0 },
      { kind: 'text', text: 'Follow for part 2 →', start: 11.5, duration: 3.5, style: (t) => pill(t, 56), animation: A('zoom', 'fade', 'block', 0.4), track: 0, position: { x: 0, y: 600 } },
      { kind: 'sticker', stickerId: 'e_1f525', start: 0.5, duration: 2, animation: 'pulse', track: 1, position: { x: 380, y: -700 }, scale: 1.4 },
      { kind: 'music', musicId: 'trap_808', volume: 0.7 },
    ],
  },
  {
    id: 'reel_fashion', name: 'Fashion Reel', category: 'Reels', presetId: 'reels', duration: 12, description: 'Beat-paced outfit reveal with glitch cuts and minimal typography.', tags: ['fashion', 'outfit', 'glitch', 'beat'], theme: THEMES.clean, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#111827,#6b7280)',
    slots: [
      ...slides(6, 2, 0, 'glitch', false).map((s) => ({ ...s, effects: [] })),
      { kind: 'text', text: 'OUTFIT CHECK', start: 0, duration: 2, style: (t) => title(t, 120, { letterSpacing: 8, uppercase: true }), animation: A('tracking', 'fade', 'block', 0.6), track: 0 },
      { kind: 'text', text: '#1', start: 2, duration: 2, style: (t) => title(t, 200), animation: A('stamp', 'fade', 'block', 0.25), track: 0, position: { x: -350, y: 650 } },
      { kind: 'text', text: '#2', start: 4, duration: 2, style: (t) => title(t, 200), animation: A('stamp', 'fade', 'block', 0.25), track: 0, position: { x: -350, y: 650 } },
      { kind: 'text', text: '#3', start: 6, duration: 2, style: (t) => title(t, 200), animation: A('stamp', 'fade', 'block', 0.25), track: 0, position: { x: -350, y: 650 } },
      { kind: 'text', text: 'Which one?', start: 10, duration: 2, style: (t) => pill(t, 60), animation: A('bounce', 'fade', 'block', 0.5), track: 0 },
      { kind: 'music', musicId: 'pop_dance', volume: 0.8 },
    ],
  },
  {
    id: 'shorts_facts', name: '3 Facts Short', category: 'Shorts', presetId: 'shorts', duration: 20, description: 'Numbered facts with a progress-style layout — perfect for educational Shorts.', tags: ['facts', 'education', 'list', 'numbers'], theme: THEMES.ocean, layout: ['text', 'text', 'video', 'audio'], cover: 'linear-gradient(135deg,#0ea5e9,#1e3a8a)',
    slots: [
      { kind: 'media', label: 'Intro clip', start: 0, duration: 3, transitionOut: { type: 'slideleft', duration: 0.4 } },
      { kind: 'media', label: 'Fact 1 footage', start: 3, duration: 5.5, transitionOut: { type: 'slideleft', duration: 0.4 } },
      { kind: 'media', label: 'Fact 2 footage', start: 8.5, duration: 5.5, transitionOut: { type: 'slideleft', duration: 0.4 } },
      { kind: 'media', label: 'Fact 3 footage', start: 14, duration: 6 },
      { kind: 'text', text: '3 things you didn’t know about…', start: 0, duration: 3, style: (t) => title(t, 84), animation: A('slideUp', 'fade', 'word', 0.5), track: 0 },
      { kind: 'text', text: '1', start: 3, duration: 5.5, style: (t) => ({ ...title(t, 260), color: t.primary }), track: 1, position: { x: -360, y: -720 }, animation: A('pop', 'fade', 'block', 0.3) },
      { kind: 'text', text: 'First fact goes here', start: 3.3, duration: 5.2, style: (t) => caption(t, 66), animation: A('slideUp', 'fade', 'word', 0.4), track: 0, position: { x: 0, y: 560 } },
      { kind: 'text', text: '2', start: 8.5, duration: 5.5, style: (t) => ({ ...title(t, 260), color: t.primary }), track: 1, position: { x: -360, y: -720 }, animation: A('pop', 'fade', 'block', 0.3) },
      { kind: 'text', text: 'Second fact goes here', start: 8.8, duration: 5.2, style: (t) => caption(t, 66), animation: A('slideUp', 'fade', 'word', 0.4), track: 0, position: { x: 0, y: 560 } },
      { kind: 'text', text: '3', start: 14, duration: 6, style: (t) => ({ ...title(t, 260), color: t.primary }), track: 1, position: { x: -360, y: -720 }, animation: A('pop', 'fade', 'block', 0.3) },
      { kind: 'text', text: 'Third fact goes here', start: 14.3, duration: 5.7, style: (t) => caption(t, 66), animation: A('slideUp', 'fade', 'word', 0.4), track: 0, position: { x: 0, y: 560 } },
      { kind: 'music', musicId: 'corporate_tech', volume: 0.5 },
    ],
  },
  {
    id: 'yt_intro', name: 'Channel Intro', category: 'Intro', presetId: 'youtube', duration: 6, description: 'Logo/name reveal with light leak and a tagline — drop in your own clip or keep the gradient.', tags: ['intro', 'logo', 'youtube', 'brand'], theme: THEMES.sunset, layout: ['text', 'text', 'overlay', 'video', 'audio'], cover: 'linear-gradient(135deg,#f97316,#ec4899)',
    slots: [
      { kind: 'color', color: (t) => t.secondary, start: 0, duration: 6, track: 3, effects: ['lightleak'] },
      { kind: 'media', label: 'Background footage (optional)', start: 0, duration: 6, track: 2, scale: 1.05 },
      { kind: 'text', text: 'YOUR CHANNEL', start: 0.3, duration: 5.4, style: (t) => title(t, 170, { letterSpacing: 6 }), animation: A('elastic', 'zoom', 'char', 0.9), track: 0 },
      { kind: 'text', text: 'new videos every week', start: 1.6, duration: 4, style: (t) => ({ fontFamily: t.font, fontWeight: 500, fontSize: 48, color: t.text, letterSpacing: 10, uppercase: true, shadow: null }), animation: A('tracking', 'fade', 'block', 0.8), track: 1, position: { x: 0, y: 130 } },
      { kind: 'music', musicId: 'edm_future', volume: 0.8 },
    ],
  },
  {
    id: 'yt_outro', name: 'End Screen', category: 'Outro', presetId: 'youtube', duration: 10, description: 'Subscribe prompt with two placeholder video slots for end-screen elements.', tags: ['outro', 'end screen', 'subscribe'], theme: THEMES.red, layout: ['text', 'sticker', 'overlay', 'overlay', 'video', 'audio'], cover: 'linear-gradient(135deg,#ef4444,#111111)',
    slots: [
      { kind: 'media', label: 'Background (blurred)', start: 0, duration: 10, track: 4, effects: ['blur'] },
      { kind: 'media', label: 'Next video', start: 0.4, duration: 9.6, track: 2, scale: 0.42, position: { x: -430, y: -40 }, transitionOut: undefined },
      { kind: 'media', label: 'Recommended video', start: 0.6, duration: 9.4, track: 3, scale: 0.42, position: { x: 430, y: -40 } },
      { kind: 'text', text: 'Thanks for watching!', start: 0, duration: 10, style: (t) => title(t, 76), animation: A('slideDown', 'fade', 'word', 0.5), track: 0, position: { x: 0, y: -400 } },
      { kind: 'text', text: 'SUBSCRIBE', start: 1, duration: 9, style: (t) => ({ ...pill(t, 56), background: { color: t.primary, padding: 22, radius: 14 } }), animation: A('pop', 'fade', 'block', 0.4), track: 0, position: { x: 0, y: 380 } },
      { kind: 'sticker', stickerId: 'arrow_curved', start: 1.2, duration: 8.8, animation: 'float', track: 1, position: { x: -300, y: 330 }, scale: 0.8 },
      { kind: 'music', musicId: 'chill_hop', volume: 0.5 },
    ],
  },
  {
    id: 'vlog_day', name: 'Day in my life', category: 'Vlog', presetId: 'tiktok', duration: 24, description: 'Timestamped vlog montage: six clips with soft cross-dissolves and time labels.', tags: ['vlog', 'lifestyle', 'day', 'routine'], theme: THEMES.violet, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#a78bfa,#f0abfc)',
    slots: [
      ...slides(6, 4, 0, 'dissolve'),
      { kind: 'text', text: 'a day in my life ✨', start: 0, duration: 4, style: (t) => ({ fontFamily: 'Caveat', fontWeight: 700, fontSize: 110, color: '#ffffff', shadow: { color: 'rgba(0,0,0,0.5)', blur: 16, x: 0, y: 4 } }), animation: A('fade', 'fade', 'char', 0.8), track: 0 },
      ...['7:00 AM', '9:30 AM', '12:00 PM', '3:00 PM', '7:00 PM'].map((s, i) => ({ kind: 'text' as const, text: s, start: 4 + i * 4, duration: 4, style: (t: TemplateTheme) => ({ fontFamily: t.font, fontWeight: 600, fontSize: 44, color: '#ffffff', background: { color: 'rgba(0,0,0,0.45)', padding: 14, radius: 10 }, shadow: null }), animation: A('slideLeft', 'fade', 'block', 0.35), track: 0, position: { x: -330, y: -780 } })),
      { kind: 'music', musicId: 'lofi_study', volume: 0.7 },
    ],
  },
  {
    id: 'gaming_montage', name: 'Clutch Montage', category: 'Gaming', presetId: 'youtube', duration: 16, description: 'High-energy gaming highlights with RGB split, shake transitions and a scoreboard-style title.', tags: ['gaming', 'montage', 'highlights', 'rgb'], theme: THEMES.neon, layout: ['text', 'sticker', 'video', 'audio'], cover: 'linear-gradient(135deg,#22c55e,#a855f7)',
    slots: [
      ...slides(4, 4, 0, 'shakecut', false).map((s, i) => ({ ...s, effects: i === 0 ? ['rgbsplit'] : [] })),
      { kind: 'text', text: 'TOP PLAYS', start: 0, duration: 2.5, style: (t) => ({ ...title(t, 160, { uppercase: true }), gradient: { from: t.primary, to: t.secondary, angle: 90 } }), animation: A('elastic', 'zoomOut', 'char', 0.7), track: 0 },
      { kind: 'text', text: '#1', start: 4, duration: 1.2, style: (t) => title(t, 220), animation: A('stamp', 'fade', 'block', 0.2), track: 0 },
      { kind: 'text', text: 'GG', start: 14, duration: 2, style: (t) => title(t, 240), animation: A('pop', 'zoom', 'block', 0.3), track: 0 },
      { kind: 'sticker', stickerId: 'e_1f3ae', start: 0.3, duration: 2.2, animation: 'shakecut', track: 1, position: { x: 650, y: -350 }, scale: 1.3 },
      { kind: 'music', musicId: 'edm_drop', volume: 0.8 },
    ],
  },
  {
    id: 'biz_promo', name: 'Product Promo', category: 'Business', presetId: 'ig-square', duration: 15, description: 'Clean square promo: hero shot, three feature callouts, offer and CTA.', tags: ['product', 'promo', 'ad', 'ecommerce'], theme: THEMES.clean, layout: ['text', 'text', 'video', 'audio'], cover: 'linear-gradient(135deg,#e5e7eb,#9ca3af)',
    slots: [
      { kind: 'media', label: 'Hero shot', start: 0, duration: 4, transitionOut: { type: 'wipeleft', duration: 0.5 }, kenBurns: true },
      { kind: 'media', label: 'Feature 1', start: 4, duration: 3, transitionOut: { type: 'wipeleft', duration: 0.5 }, kenBurns: true },
      { kind: 'media', label: 'Feature 2', start: 7, duration: 3, transitionOut: { type: 'wipeleft', duration: 0.5 }, kenBurns: true },
      { kind: 'media', label: 'Feature 3 / lifestyle', start: 10, duration: 5, kenBurns: true },
      { kind: 'text', text: 'Introducing', start: 0.3, duration: 1.6, style: (t) => ({ fontFamily: t.font, fontWeight: 500, fontSize: 40, color: '#fff', letterSpacing: 12, uppercase: true, shadow: null }), animation: A('tracking', 'fade', 'block', 0.6), track: 1, position: { x: 0, y: -120 } },
      { kind: 'text', text: 'PRODUCT NAME', start: 0.8, duration: 3.2, style: (t) => title(t, 96), animation: A('slideUp', 'fade', 'word', 0.5), track: 0 },
      { kind: 'text', text: 'Feature one', start: 4.2, duration: 2.8, style: (t) => pill(t, 46), animation: A('slideLeft', 'fade', 'block', 0.4), track: 0, position: { x: 0, y: 380 } },
      { kind: 'text', text: 'Feature two', start: 7.2, duration: 2.8, style: (t) => pill(t, 46), animation: A('slideLeft', 'fade', 'block', 0.4), track: 0, position: { x: 0, y: 380 } },
      { kind: 'text', text: 'Feature three', start: 10.2, duration: 2.3, style: (t) => pill(t, 46), animation: A('slideLeft', 'fade', 'block', 0.4), track: 0, position: { x: 0, y: 380 } },
      { kind: 'text', text: 'Shop now — 20% off', start: 12.5, duration: 2.5, style: (t) => ({ ...title(t, 70), background: { color: '#ffffff', padding: 24, radius: 16 }, color: '#111827', shadow: null }), animation: A('pop', 'fade', 'block', 0.4), track: 0 },
      { kind: 'music', musicId: 'corporate_bright', volume: 0.6 },
    ],
  },
  {
    id: 'edu_explainer', name: 'Explainer', category: 'Education', presetId: 'youtube', duration: 20, description: 'Talking-head friendly layout with topic title, step chapters and a summary card.', tags: ['education', 'tutorial', 'steps', 'explainer'], theme: THEMES.ocean, layout: ['text', 'text', 'video', 'audio'], cover: 'linear-gradient(135deg,#38bdf8,#0369a1)',
    slots: [
      { kind: 'media', label: 'Main footage', start: 0, duration: 20 },
      { kind: 'text', text: 'How to ___ in 3 steps', start: 0.2, duration: 3.5, style: (t) => title(t, 92), animation: A('slideUp', 'fade', 'word', 0.5), track: 0 },
      ...['Step 1', 'Step 2', 'Step 3'].map((s, i) => ({ kind: 'text' as const, text: s, start: 4 + i * 5, duration: 5, style: (t: TemplateTheme) => ({ ...pill(t, 44), background: { color: t.primary, padding: 14, radius: 8 } }), animation: A('slideLeft', 'slideLeft', 'block', 0.35), track: 1, position: { x: -700, y: -420 } })),
      ...['Explain the first step', 'Explain the second step', 'Explain the third step'].map((s, i) => ({ kind: 'text' as const, text: s, start: 4.3 + i * 5, duration: 4.7, style: (t: TemplateTheme) => ({ fontFamily: t.font, fontWeight: 600, fontSize: 44, color: '#fff', align: 'left' as const, background: { color: 'rgba(0,0,0,0.55)', padding: 16, radius: 8 }, shadow: null }), animation: A('fade', 'fade', 'block', 0.3), track: 0, position: { x: -430, y: 420 } })),
      { kind: 'text', text: 'Recap: 1 · 2 · 3', start: 19, duration: 1, style: (t) => title(t, 72), animation: A('fade', 'fade', 'block', 0.3), track: 0 },
      { kind: 'music', musicId: 'ambient_morning', volume: 0.35 },
    ],
  },
  {
    id: 'meme_caption', name: 'Meme Caption', category: 'Meme', presetId: 'ig-square', duration: 6, description: 'Classic top/bottom Impact-style meme text over your clip or image.', tags: ['meme', 'funny', 'impact', 'caption'], theme: THEMES.clean, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#fde047,#f97316)',
    slots: [
      { kind: 'media', label: 'Meme clip / image', start: 0, duration: 6 },
      { kind: 'text', text: 'WHEN YOU FINALLY', start: 0, duration: 6, style: () => ({ fontFamily: 'Anton', fontSize: 86, color: '#ffffff', outline: { color: '#000000', width: 8 }, uppercase: true, shadow: null }), track: 0, position: { x: 0, y: -420 } },
      { kind: 'text', text: 'FINISH THE EDIT', start: 1.5, duration: 4.5, style: () => ({ fontFamily: 'Anton', fontSize: 86, color: '#ffffff', outline: { color: '#000000', width: 8 }, uppercase: true, shadow: null }), animation: A('pop', 'fade', 'block', 0.2), track: 0, position: { x: 0, y: 420 } },
      { kind: 'music', musicId: 'funk_groove', volume: 0.6 },
    ],
  },
  {
    id: 'slideshow_memories', name: 'Memories Slideshow', category: 'Slideshow', presetId: 'youtube', duration: 32, description: 'Eight photos with Ken Burns motion, warm film look and a dedication title.', tags: ['photos', 'slideshow', 'memories', 'wedding', 'birthday'], theme: THEMES.gold, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#d4a017,#7c2d12)',
    slots: [
      ...slides(8, 4, 0, 'dissolve', true).map((s) => ({ ...s, effects: ['film'] })),
      { kind: 'text', text: 'Our best moments', start: 0.5, duration: 4, style: (t) => ({ fontFamily: t.headingFont, fontWeight: 700, fontSize: 110, italic: true, color: '#fff7e6', shadow: { color: 'rgba(0,0,0,0.6)', blur: 20, x: 0, y: 6 } }), animation: A('blur', 'fade', 'word', 0.9), track: 0 },
      { kind: 'text', text: '2026', start: 28, duration: 4, style: (t) => ({ fontFamily: t.headingFont, fontWeight: 700, fontSize: 90, color: '#fff7e6', shadow: null, letterSpacing: 14 }), animation: A('tracking', 'fade', 'block', 1), track: 0 },
      { kind: 'music', musicId: 'cine_emotional', volume: 0.8 },
    ],
  },
  {
    id: 'captions_talking', name: 'Talking Head + Captions', category: 'Captions', presetId: 'tiktok', duration: 30, description: 'Single clip, bold centered caption style placeholder — run Auto captions after import to fill it.', tags: ['captions', 'talking head', 'podcast', 'subtitles'], theme: THEMES.violet, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#312e81,#8b5cf6)',
    slots: [
      { kind: 'media', label: 'Talking clip', start: 0, duration: 30 },
      { kind: 'text', text: 'Run AI → Auto captions to replace this', start: 0, duration: 4, style: (t) => ({ ...caption(t, 64), color: '#ffe600' }), animation: A('pop', 'fade', 'word', 0.3), track: 0, position: { x: 0, y: 300 } },
      { kind: 'music', musicId: 'lofi_rain', volume: 0.2 },
    ],
  },
  {
    id: 'travel_cinematic', name: 'Cinematic Travel', category: 'Travel', presetId: 'cinema', duration: 24, description: 'Letterboxed 2.39:1 montage with teal-orange grade, slow zooms and destination title.', tags: ['travel', 'cinematic', 'drone', 'letterbox'], theme: THEMES.ocean, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#0f766e,#f59e0b)',
    slots: [
      ...slides(6, 4, 0, 'luma', true).map((s) => ({ ...s, effects: ['tealorange'] })),
      { kind: 'text', text: 'DESTINATION', start: 1, duration: 4, style: (t) => title(t, 120, { letterSpacing: 24, uppercase: true, fontWeight: 400 }), animation: A('tracking', 'fade', 'block', 1.2), track: 0 },
      { kind: 'text', text: 'shot on ___', start: 21, duration: 3, style: (t) => ({ fontFamily: t.font, fontWeight: 400, fontSize: 36, color: '#fff', letterSpacing: 6, uppercase: true, shadow: null }), animation: A('fade', 'fade', 'block', 0.6), track: 0 },
      { kind: 'music', musicId: 'cine_epic', volume: 0.8 },
    ],
  },
  {
    id: 'music_visualizer', name: 'Lyric Video', category: 'Music', presetId: 'youtube', duration: 20, description: 'Lyric-style kinetic text over a looping clip with a chromatic glow look.', tags: ['music', 'lyrics', 'kinetic', 'typography'], theme: THEMES.neon, layout: ['text', 'video', 'audio'], cover: 'linear-gradient(135deg,#a855f7,#22c55e)',
    slots: [
      { kind: 'media', label: 'Background loop', start: 0, duration: 20, effects: ['chromatic'] },
      ...['First line of the lyric', 'Second line goes here', 'Third line hits harder', 'And the chorus repeats'].map((s, i) => ({ kind: 'text' as const, text: s, start: i * 5, duration: 5, style: (t: TemplateTheme) => ({ ...title(t, 96), glow: { color: t.primary, blur: 40 } }), animation: A(i % 2 ? 'slideUp' : 'typewriter', 'blur', i % 2 ? 'word' : 'char', 0.8), track: 0 })),
      { kind: 'music', musicId: 'synth_retro', volume: 0.9 },
    ],
  },
  {
    id: 'fitness_workout', name: 'Workout Timer', category: 'Fitness', presetId: 'reels', duration: 24, description: 'Exercise names with rep counts and rest cards — fast, punchy, high contrast.', tags: ['fitness', 'gym', 'workout', 'timer'], theme: THEMES.red, layout: ['text', 'text', 'video', 'audio'], cover: 'linear-gradient(135deg,#ef4444,#7f1d1d)',
    slots: [
      ...slides(4, 6, 0, 'zoomin', false),
      ...['PUSH UPS', 'SQUATS', 'PLANK', 'BURPEES'].map((s, i) => ({ kind: 'text' as const, text: s, start: i * 6, duration: 6, style: (t: TemplateTheme) => title(t, 110, { uppercase: true }), animation: A('slideLeft', 'slideRight', 'block', 0.3), track: 0, position: { x: 0, y: -650 } })),
      ...['x15', 'x20', '45s', 'x10'].map((s, i) => ({ kind: 'text' as const, text: s, start: i * 6 + 0.3, duration: 5.7, style: (t: TemplateTheme) => ({ ...pill(t, 64), background: { color: t.primary, padding: 20, radius: 12 } }), animation: A('pop', 'fade', 'block', 0.3), track: 1, position: { x: 0, y: 650 } })),
      { kind: 'music', musicId: 'rock_drive', volume: 0.8 },
    ],
  },
  {
    id: 'food_recipe', name: 'Quick Recipe', category: 'Food', presetId: 'tiktok', duration: 20, description: 'Ingredient list, step overlays and a final reveal with a warm look.', tags: ['food', 'recipe', 'cooking', 'kitchen'], theme: THEMES.sunset, layout: ['text', 'text', 'video', 'audio'], cover: 'linear-gradient(135deg,#fb923c,#b45309)',
    slots: [
      { kind: 'media', label: 'Ingredients shot', start: 0, duration: 4, transitionOut: { type: 'push', duration: 0.4 } },
      { kind: 'media', label: 'Step 1', start: 4, duration: 4, transitionOut: { type: 'push', duration: 0.4 } },
      { kind: 'media', label: 'Step 2', start: 8, duration: 4, transitionOut: { type: 'push', duration: 0.4 } },
      { kind: 'media', label: 'Step 3', start: 12, duration: 4, transitionOut: { type: 'dissolve', duration: 0.6 } },
      { kind: 'media', label: 'Final plate', start: 16, duration: 4, kenBurns: true },
      { kind: 'text', text: '5-minute recipe 🍳', start: 0, duration: 4, style: (t) => title(t, 90), animation: A('bounce', 'fade', 'word', 0.5), track: 0, position: { x: 0, y: -600 } },
      { kind: 'text', text: '• ingredient 1\n• ingredient 2\n• ingredient 3', start: 0.6, duration: 3.4, style: (t) => ({ fontFamily: t.font, fontWeight: 600, fontSize: 46, color: '#fff', align: 'left', background: { color: 'rgba(0,0,0,0.5)', padding: 20, radius: 12 }, shadow: null, lineHeight: 1.3 }), animation: A('slideUp', 'fade', 'line', 0.4), track: 1 },
      ...['1. Prep', '2. Cook', '3. Season'].map((s, i) => ({ kind: 'text' as const, text: s, start: 4 + i * 4, duration: 4, style: (t: TemplateTheme) => pill(t, 52), animation: A('slideLeft', 'fade', 'block', 0.35), track: 0, position: { x: 0, y: -700 } })),
      { kind: 'text', text: 'Enjoy!', start: 16.5, duration: 3.5, style: (t) => ({ fontFamily: 'Caveat', fontWeight: 700, fontSize: 140, color: '#fff', shadow: { color: 'rgba(0,0,0,0.5)', blur: 18, x: 0, y: 6 } }), animation: A('pop', 'fade', 'block', 0.4), track: 0 },
      { kind: 'music', musicId: 'acoustic_ukulele', volume: 0.7 },
    ],
  },
  {
    id: 'promo_sale', name: 'Flash Sale', category: 'Promo', presetId: 'ig-portrait', duration: 8, description: 'Loud countdown-style sale announcement with pulsing badge and CTA.', tags: ['sale', 'promo', 'discount', 'ad'], theme: THEMES.sunset, layout: ['text', 'sticker', 'video', 'audio'], cover: 'linear-gradient(135deg,#f43f5e,#f97316)',
    slots: [
      { kind: 'color', color: (t) => t.primary, start: 0, duration: 8, track: 2 },
      { kind: 'media', label: 'Product footage (optional)', start: 0, duration: 8, track: 2, scale: 0.9 },
      { kind: 'text', text: 'FLASH SALE', start: 0, duration: 8, style: (t) => title(t, 150, { uppercase: true }), animation: A('elastic', 'zoom', 'char', 0.7), track: 0, position: { x: 0, y: -350 } },
      { kind: 'text', text: '-50%', start: 0.8, duration: 7.2, style: (t) => ({ ...title(t, 260), color: '#fff200' }), animation: A('pop', 'zoom', 'block', 0.4), track: 0 },
      { kind: 'text', text: 'Today only · link in bio', start: 1.6, duration: 6.4, style: (t) => ({ ...pill(t, 52), background: { color: '#111111', padding: 20, radius: 40 } }), animation: A('slideUp', 'fade', 'block', 0.4), track: 0, position: { x: 0, y: 420 } },
      { kind: 'sticker', stickerId: 'star', start: 0.5, duration: 7.5, animation: 'spin', track: 1, position: { x: 380, y: -560 }, scale: 1.2 },
      { kind: 'music', musicId: 'latin_reggaeton', volume: 0.8 },
    ],
  },
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['TikTok', 'Reels', 'Shorts', 'YouTube', 'Intro', 'Outro', 'Vlog', 'Gaming', 'Business', 'Education', 'Promo', 'Meme', 'Slideshow', 'Captions', 'Travel', 'Music', 'Fitness', 'Food'];
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id);
export const mediaSlotsOf = (t: TemplateDef) => t.slots.filter((s): s is Extract<TemplateSlot, { kind: 'media' }> => s.kind === 'media');

export interface BuildOptions {
  name?: string;
  theme?: Partial<TemplateTheme>;
  /** media per media-slot index; null → placeholder */
  media?: (MediaAsset | null)[];
  /** rendered music asset (from library/music → importFile) or null to skip music */
  musicAsset?: MediaAsset | null;
  musicVolume?: number;
  /** Scale slot timing to match this total duration */
  totalDuration?: number;
}

/** Build a fully editable Project from a template definition. */
export function buildTemplateProject(def: TemplateDef, opts: BuildOptions = {}): Project {
  const preset = SOCIAL_PRESETS.find((p) => p.id === def.presetId) || SOCIAL_PRESETS[0];
  const theme: TemplateTheme = { ...def.theme, ...(opts.theme || {}) };
  const timeScale = opts.totalDuration ? opts.totalDuration / def.duration : 1;
  const project = makeProject(opts.name || def.name, { width: preset.width, height: preset.height, fps: preset.fps, presetId: preset.id });
  project.templateId = def.id;
  project.tracks = def.layout.map((k, i) => makeTrack(k, `${k[0].toUpperCase()}${k.slice(1)} ${i + 1}`));
  const defaultTrackFor = (kind: TrackKind) => project.tracks.findIndex((t) => t.kind === kind);
  const push = (trackIdx: number, clip: Clip) => {
    const t = project.tracks[Math.max(0, Math.min(project.tracks.length - 1, trackIdx))];
    clip.trackId = t.id;
    t.clips.push(clip);
  };
  let mediaIdx = 0;
  const baseScale = (asset: MediaAsset | null, extra = 1) => extra;
  for (const s of def.slots) {
    if (s.kind === 'music') {
      if (opts.musicAsset) {
        const dur = opts.musicAsset.duration > 0 ? Math.min(opts.musicAsset.duration, def.duration * timeScale) : def.duration * timeScale;
        const clip = makeAudioClip({ trackId: '', mediaId: opts.musicAsset.id, name: opts.musicAsset.name, start: 0, duration: dur });
        clip.audio.volume = { value: opts.musicVolume ?? s.volume ?? 0.7 };
        clip.audio.fadeOut = Math.min(2, dur / 4);
        push(defaultTrackFor('audio'), clip);
        if (!project.mediaIds.includes(opts.musicAsset.id)) project.mediaIds.push(opts.musicAsset.id);
      }
      continue;
    }
    const start = s.start * timeScale;
    const duration = s.duration * timeScale;
    const trackIdx = s.track ?? (s.kind === 'media' || s.kind === 'color' ? defaultTrackFor('video') : s.kind === 'text' ? defaultTrackFor('text') : s.kind === 'sticker' ? Math.max(0, defaultTrackFor('sticker')) : 0);
    let clip: Clip | null = null;
    if (s.kind === 'media') {
      const asset = opts.media?.[mediaIdx++] ?? null;
      if (asset && asset.type === 'video') clip = makeVideoClip({ trackId: '', mediaId: asset.id, name: asset.name, start, duration: asset.duration > 0 ? Math.min(duration, asset.duration) : duration, hasAudio: asset.hasAudio });
      else if (asset && asset.type === 'image') clip = makeImageClip({ trackId: '', mediaId: asset.id, name: asset.name, start, duration });
      else {
        // labelled placeholder so the user knows what to drop here
        clip = makeColorClip({ trackId: '', color: placeholderColor(mediaIdx), start, duration, name: `📥 ${s.label}` });
        (clip as any).placeholder = s.label;
      }
      if (asset && !project.mediaIds.includes(asset.id)) project.mediaIds.push(asset.id);
      if (clip && s.kenBurns && clip.kind !== 'color') {
        const v = clip as any;
        v.transform.scale = { value: { x: 1, y: 1 }, keyframes: [{ id: uid('kf'), time: 0, value: { x: 1.0, y: 1.0 }, easing: 'easeInOut' }, { id: uid('kf'), time: duration, value: { x: 1.12, y: 1.12 }, easing: 'easeInOut' }] };
      }
    } else if (s.kind === 'color') clip = makeColorClip({ trackId: '', color: s.color(theme), start, duration, name: 'Background' });
    else if (s.kind === 'text') clip = makeTextClip({ trackId: '', text: s.text, start, duration, style: s.style(theme), animation: s.animation });
    else if (s.kind === 'sticker') clip = makeStickerClip({ trackId: '', stickerId: s.stickerId, name: s.stickerId, start, duration, animation: s.animation ?? null });
    if (!clip) continue;
    const v = clip as any;
    if (v.transform) {
      if (s.scale && s.scale !== 1) v.transform.scale = { ...v.transform.scale, value: { x: baseScale(null, s.scale), y: baseScale(null, s.scale) } };
      if (s.position) v.transform.position = { value: { x: s.position.x, y: s.position.y } };
      if (s.effects?.length) v.effects = s.effects.map((type) => ({ id: uid('fx'), type, enabled: true, params: {} }));
      if (s.transitionOut) v.transitionOut = { type: s.transitionOut.type, duration: s.transitionOut.duration, params: {} };
    }
    push(trackIdx, clip);
  }
  // sort clips by start & drop stray overlaps caused by rounding
  for (const t of project.tracks) t.clips.sort((a, b) => a.start - b.start);
  return project;
}

function placeholderColor(i: number) {
  const hues = [262, 199, 340, 150, 30, 210, 280, 90];
  return `hsl(${hues[i % hues.length]} 25% 22%)`;
}
