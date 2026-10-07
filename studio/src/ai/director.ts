/**
 * AI director — turns a free-text brief ("make this a 30 s TikTok with yellow captions and lo-fi music")
 * into a structured EditPlan, which directorApply.ts executes step by step with the real tools of the
 * editor (highlight detection, silence removal, Whisper captions, music synth, transitions, grades…).
 *
 * The plan can come from:
 *   • an LLM (local in-browser model or an OpenAI-compatible API) — see llm.ts;
 *   • the built-in keyword rules (no model; multilingual EN / FR / AR / Darija keywords).
 * The user always sees the plan before anything is applied.
 */
import { EFFECTS, getEffect } from '@/library/effects';
import { TRANSITIONS, getTransition } from '@/library/transitions';
import { CAPTION_STYLES } from '@/library/captionStyles';
import { COLOR_PRESETS, getColorPreset } from '@/library/colorPresets';
import { TEXT_PRESETS, getTextPreset } from '@/library/textPresets';
import { GENRES, MOODS } from '@/library/music';
import type { Project } from '@/core/types';
import * as cmd from '@/core/commands';
import { getAsset } from '@/engine/MediaManager';
import type { ChatMessage } from './llm';

export type Aspect = '9:16' | '16:9' | '1:1' | '4:5';
export type CutStrategy = 'keep' | 'highlights' | 'silence' | 'jumpcut';

export interface EditPlan {
  summary: string;
  aspect: Aspect | null;
  targetDuration: number | null;
  pace: 'slow' | 'medium' | 'fast';
  cut: CutStrategy;
  /** Split clips at detected scene changes (can combine with any cut strategy). */
  splitScenes: boolean;
  speed: number | null;
  beatSync: boolean;
  zoomPunches: boolean;
  reframe: boolean;
  stabilize: boolean;
  captions: { enabled: boolean; style: string; language: string | null };
  music: { enabled: boolean; genre: string | null; mood: string | null; volume: number; duck: boolean };
  loudness: boolean;
  color: { preset: string | null; auto: boolean };
  effects: string[];
  transition: { type: string | null; duration: number };
  title: { text: string; preset: string } | null;
  endCard: { text: string; preset: string } | null;
  notes: string[];
}

export const emptyPlan = (): EditPlan => ({
  summary: '',
  aspect: null,
  targetDuration: null,
  pace: 'medium',
  cut: 'keep',
  splitScenes: false,
  speed: null,
  beatSync: false,
  zoomPunches: false,
  reframe: false,
  stabilize: false,
  captions: { enabled: false, style: 'hormozi', language: null },
  music: { enabled: false, genre: null, mood: null, volume: 0.35, duck: true },
  loudness: false,
  color: { preset: null, auto: false },
  effects: [],
  transition: { type: null, duration: 0.5 },
  title: null,
  endCard: null,
  notes: [],
});

/* ------------------------------ project context ------------------------------ */
export interface ProjectContext {
  width: number;
  height: number;
  fps: number;
  duration: number;
  videoClips: { name: string; duration: number; hasAudio: boolean; width: number; height: number }[];
  imageClips: number;
  audioClips: number;
  textClips: number;
  hasCaptions: boolean;
}
export function projectContext(p: Project): ProjectContext {
  const all = cmd.allClips(p);
  const videos = all.filter((c) => c.kind === 'video') as any[];
  return {
    width: p.settings.width,
    height: p.settings.height,
    fps: p.settings.fps,
    duration: cmd.projectDuration(p),
    videoClips: videos.map((c) => {
      const a = getAsset(c.mediaId);
      return { name: c.name, duration: c.duration, hasAudio: c.hasAudio !== false, width: a?.width || 0, height: a?.height || 0 };
    }),
    imageClips: all.filter((c) => c.kind === 'image').length,
    audioClips: all.filter((c) => c.kind === 'audio').length,
    textClips: all.filter((c) => c.kind === 'text').length,
    hasCaptions: all.some((c) => c.kind === 'caption'),
  };
}

/* --------------------------------- prompt --------------------------------- */
const POPULAR_EFFECTS = ['glitch', 'vhs', 'filmgrain', 'bloom', 'lightleak', 'vignette', 'chromatic', 'shake', 'zoomblur', 'neonedges', 'halftone', 'duotone', 'bw', 'sharpen', 'blur', 'oldfilm', 'crt', 'rgbsplit', 'dreamy', 'flash', 'rain', 'snow', 'sparkle', 'kaleidoscope', 'pixelate', 'mirror', 'fisheye', 'tiltshift', 'thermal', 'posterize'];

export function catalogForPrompt(full = false) {
  const fx = (full ? EFFECTS : EFFECTS.filter((e) => POPULAR_EFFECTS.includes(e.id))).map((e) => `${e.id} (${e.name})`);
  return {
    effects: fx.join(', '),
    transitions: TRANSITIONS.map((t) => t.id).join(', '),
    captionStyles: CAPTION_STYLES.map((c) => `${c.id} (${c.name})`).join(', '),
    colorPresets: COLOR_PRESETS.filter((c) => c.id !== 'none').map((c) => `${c.id} (${c.name})`).join(', '),
    textPresets: TEXT_PRESETS.map((t) => t.id).join(', '),
    genres: GENRES.join(', '),
    moods: MOODS.join(', '),
  };
}

export function buildMessages(brief: string, ctx: ProjectContext, opts: { fullCatalog?: boolean } = {}): ChatMessage[] {
  const cat = catalogForPrompt(opts.fullCatalog);
  const system = `You are the edit planner inside a video editor. Convert the user's brief into ONE JSON object (no markdown, no commentary) with exactly these keys:
{
 "summary": string (one sentence, same language as the brief),
 "aspect": "9:16" | "16:9" | "1:1" | "4:5" | null,
 "targetDuration": number seconds | null,
 "pace": "slow" | "medium" | "fast",
 "cut": "keep" | "highlights" | "silence" | "jumpcut",
 "splitScenes": boolean,
 "speed": number 0.25..4 | null,
 "beatSync": boolean, "zoomPunches": boolean, "reframe": boolean, "stabilize": boolean,
 "captions": { "enabled": boolean, "style": one of [${cat.captionStyles}], "language": ISO-639-1 code | null },
 "music": { "enabled": boolean, "genre": one of [${cat.genres}] | null, "mood": one of [${cat.moods}] | null, "volume": 0..1, "duck": boolean },
 "loudness": boolean,
 "color": { "preset": one of [${cat.colorPresets}] | null, "auto": boolean },
 "effects": array of ids from [${cat.effects}] (max 3, usually 0-1),
 "transition": { "type": one of [${cat.transitions}] | null, "duration": seconds 0.2..1.5 },
 "title": { "text": string, "preset": one of [${cat.textPresets}] } | null,
 "endCard": { "text": string, "preset": id } | null,
 "notes": array of short strings explaining choices or things you could not do
}
Rules: "cut" = "highlights" when the user wants the best moments / a shorter video; "silence" or "jumpcut" for talking videos with pauses; "keep" otherwise. "splitScenes" true when the user wants cuts at shot/scene changes. Set "reframe" true when aspect changes to vertical from landscape footage. TikTok/Reels/Shorts = 9:16, YouTube = 16:9. Captions "enabled" when the user mentions subtitles/captions or when it is a talking video for social media. Only use ids from the lists. Unknown wishes go to "notes". Output JSON only.`;
  const context = `Project: ${ctx.width}x${ctx.height} @ ${ctx.fps}fps, timeline ${ctx.duration.toFixed(1)} s. Video clips: ${ctx.videoClips.length ? ctx.videoClips.map((v) => `"${v.name}" ${v.duration.toFixed(1)}s ${v.width}x${v.height}${v.hasAudio ? '' : ' (no audio)'}`).join('; ') : 'none'}. Images: ${ctx.imageClips}. Audio clips: ${ctx.audioClips}. Text clips: ${ctx.textClips}. Captions already present: ${ctx.hasCaptions ? 'yes' : 'no'}.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: `${context}\n\nBrief: ${brief}` },
  ];
}

/* ------------------------------ parse & validate ------------------------------ */
export function parsePlan(text: string): EditPlan {
  let raw: any = null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return JSON.');
  const slice = cleaned.slice(start, end + 1);
  try {
    raw = JSON.parse(slice);
  } catch {
    // light repair: trailing commas, single quotes
    try {
      raw = JSON.parse(slice.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'));
    } catch {
      throw new Error('The model returned malformed JSON.');
    }
  }
  return sanitizePlan(raw);
}

const ASPECTS: Aspect[] = ['9:16', '16:9', '1:1', '4:5'];
const CUTS: CutStrategy[] = ['keep', 'highlights', 'silence', 'jumpcut'];
const num = (v: any, min: number, max: number, fb: number | null): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
};
const bool = (v: any, fb = false) => (typeof v === 'boolean' ? v : typeof v === 'string' ? /^(true|yes|1)$/i.test(v) : fb);
const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const pick = <T extends string>(v: any, list: readonly T[], fb: T | null): T | null => {
  const s = str(v);
  if (!s) return fb;
  const lower = s.toLowerCase();
  return (list.find((x) => x.toLowerCase() === lower) as T | undefined) ?? (list.find((x) => lower.includes(x.toLowerCase())) as T | undefined) ?? fb;
};

export function sanitizePlan(raw: any): EditPlan {
  const p = emptyPlan();
  const notes: string[] = Array.isArray(raw?.notes) ? raw.notes.filter((n: any) => typeof n === 'string').slice(0, 8) : [];
  p.summary = str(raw?.summary) ?? '';
  p.aspect = pick(raw?.aspect, ASPECTS, null);
  p.targetDuration = num(raw?.targetDuration, 2, 3600, null);
  p.pace = pick(raw?.pace, ['slow', 'medium', 'fast'] as const, 'medium')!;
  p.cut = pick(raw?.cut, CUTS, 'keep')!;
  p.splitScenes = bool(raw?.splitScenes) || /^scenes?$/i.test(String(raw?.cut ?? ''));
  p.speed = num(raw?.speed, 0.25, 4, null);
  if (p.speed !== null && Math.abs(p.speed - 1) < 0.01) p.speed = null;
  p.beatSync = bool(raw?.beatSync);
  p.zoomPunches = bool(raw?.zoomPunches);
  p.reframe = bool(raw?.reframe);
  p.stabilize = bool(raw?.stabilize);
  p.loudness = bool(raw?.loudness);
  const cs = raw?.captions || {};
  const styleId = pick(cs.style, CAPTION_STYLES.map((c) => c.id), 'hormozi')!;
  p.captions = { enabled: bool(cs.enabled), style: styleId, language: str(cs.language)?.slice(0, 5).toLowerCase() ?? null };
  if (p.captions.language === 'auto') p.captions.language = null;
  const m = raw?.music || {};
  p.music = { enabled: bool(m.enabled), genre: pick(m.genre, GENRES, null), mood: pick(m.mood, MOODS, null), volume: num(m.volume, 0.05, 1, 0.35)!, duck: bool(m.duck, true) };
  const c = raw?.color || {};
  const preset = str(c.preset);
  p.color = { preset: preset && getColorPreset(preset) && preset !== 'none' ? preset : preset ? (COLOR_PRESETS.find((x) => x.name.toLowerCase() === preset.toLowerCase())?.id ?? null) : null, auto: bool(c.auto) };
  if (preset && !p.color.preset && preset !== 'none') notes.push(`Unknown color preset "${preset}" was ignored.`);
  const fxIn: any[] = Array.isArray(raw?.effects) ? raw.effects : typeof raw?.effects === 'string' ? raw.effects.split(/[,\s]+/) : [];
  for (const f of fxIn) {
    const id = str(typeof f === 'object' ? f?.id : f);
    if (!id) continue;
    const def = getEffect(id) || EFFECTS.find((e) => e.name.toLowerCase() === id.toLowerCase()) || EFFECTS.find((e) => e.id.includes(id.toLowerCase()));
    if (def && !p.effects.includes(def.id)) p.effects.push(def.id);
    else if (!def) notes.push(`Unknown effect "${id}" was ignored.`);
    if (p.effects.length >= 3) break;
  }
  const tr = raw?.transition || {};
  const trType = str(tr.type);
  p.transition = { type: trType && getTransition(trType) ? trType : trType ? (TRANSITIONS.find((t) => t.name.toLowerCase() === trType.toLowerCase())?.id ?? null) : null, duration: num(tr.duration, 0.2, 1.5, 0.5)! };
  if (trType && !p.transition.type && !/^(none|null)$/i.test(trType)) notes.push(`Unknown transition "${trType}" was ignored.`);
  const t = raw?.title;
  if (t && str(t.text)) p.title = { text: str(t.text)!.slice(0, 80), preset: getTextPreset(str(t.preset) || '') ? str(t.preset)! : 'tiktok_bold' };
  const e = raw?.endCard;
  if (e && str(e.text)) p.endCard = { text: str(e.text)!.slice(0, 80), preset: getTextPreset(str(e.preset) || '') ? str(e.preset)! : 'story_pill' };
  p.notes = notes;
  return p;
}

/* ------------------------------ keyword rules ------------------------------ */
/** Offline fallback: multilingual keyword parser (English, French, Arabic, Moroccan Darija in Latin + Arabic script). */
export function rulesPlan(brief: string, ctx: ProjectContext): EditPlan {
  const p = emptyPlan();
  const b = ` ${brief.toLowerCase()} `;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // prefix-at-word-start match: "rain" must not match "grain", "rap" must not match "trap" — but "stabiliz" still matches "stabilization"
  const cache = new Map<string, RegExp>();
  const re = (w: string) => { let r = cache.get(w); if (!r) { r = new RegExp('(^|[^\\p{L}\\d])(?:وال|بال|لل|ال|و|ف|ب|ل)?' + esc(w.trimStart()), 'u'); cache.set(w, r); } return r; };
  const has = (...words: string[]) => words.some((w) => re(w).test(b));
  const neg = (word: string) => new RegExp(`(no|without|sans|pas de|bla|بلا|بدون|ما ?بغيت(ش)?|machi)\\s+(\\w+\\s+){0,2}${word}`).test(b);

  // aspect
  if (has('tiktok', 'tik tok', 'reels', 'reel', 'shorts', 'short ', 'vertical', '9:16', 'story', 'stories', 'snap', 'تيك توك', 'ريلز', 'عمودي', 'ستوري')) p.aspect = '9:16';
  else if (has('youtube', '16:9', 'landscape', 'horizontal', 'paysage', 'يوتيوب', 'أفقي', 'wide')) p.aspect = '16:9';
  else if (has('square', 'carré', '1:1', 'مربع')) p.aspect = '1:1';
  else if (has('4:5', 'portrait post')) p.aspect = '4:5';

  // duration
  const dm = b.match(/(\d+(?:[.,]\d+)?)\s*(?:s\b|sec|secs|seconds?|secondes?|ثانية|ثواني|thania|thawani|tawani)/) || b.match(/(\d+(?:[.,]\d+)?)\s*(?:min|mins|minutes?|دقيقة|دقائق|d9i9a|d9ay9|dqiqa)/);
  if (dm) {
    const v = parseFloat(dm[1].replace(',', '.'));
    p.targetDuration = /min|دقيق|d9|dqiq/.test(dm[0]) ? v * 60 : v;
  }

  // pace
  if (has('fast', 'quick', 'rapide', 'dynamic', 'dynamique', 'energetic', 'énergique', 'punchy', 'سريع', 'sri3', 'zarba', 'bzerba', 'b zerba', 'hype', 'intense')) p.pace = 'fast';
  else if (has('slow', 'calm', 'calme', 'lent', 'relax', 'chill', 'smooth', 'doux', 'هادئ', 'بطيء', 'hadi', 'bchwiya', 'b chwiya', 'cinematic', 'cinématique')) p.pace = 'slow';

  // cut strategy
  if (has('best moment', 'best part', 'highlight', 'meilleur', 'temps fort', 'أفضل', 'أحسن', 'a7san', 'ahsan', 'lmoments', 'les moments', 'resume', 'résumé', 'summary', 'summar', 'recap', 'shorter', 'raccourci', 'court', '9sar', '9ssar', 'qsar', 'ikhtisar', 'اختصار', 'قصر', 'قصير', 'قصيرة')) p.cut = 'highlights';
  else if (has('jump cut', 'jumpcut', 'jump-cut')) p.cut = 'jumpcut';
  else if (has('silence', 'silences', 'pause', 'pauses', 'blancs', 'dead air', 'سكوت', 'skat', 'skout', 'lwa9t lfaregh', 'فراغ')) p.cut = 'silence';
  else if (p.targetDuration && p.targetDuration < ctx.duration * 0.9) p.cut = 'highlights';
  p.splitScenes = has('scene', 'scènes', 'scenes', 'shots', 'plans', 'مشاهد', 'مشهد', 'par plan', 'cut by shot');

  // speed
  const sm = b.match(/(\d+(?:[.,]\d+)?)\s*x\b/);
  if (sm) p.speed = Math.max(0.25, Math.min(4, parseFloat(sm[1].replace(',', '.'))));
  else if (has('slow motion', 'slow-mo', 'slowmo', 'ralenti', 'بطيئة', 'slow mo')) p.speed = 0.5;
  else if (has('timelapse', 'time-lapse', 'speed up', 'accélér', 'accelere', 'تسريع', 'sar3', 'zid f sor3a')) p.speed = 2;

  // captions
  if (has('caption', 'subtitle', 'sous-titre', 'sous titre', 'soustitre', 'ترجمة', 'كابشن', 'الكلام مكتوب', 'ktaba', 'kitaba', 'lktaba', 'text on screen', 'transcri', 'subs', 'cc ')) p.captions.enabled = !neg('caption') && !neg('subtitle') && !neg('sous');
  if (p.captions.enabled) {
    if (has('yellow', 'jaune', 'hormozi', 'أصفر', 'sfar')) p.captions.style = 'hormozi';
    else if (has('karaoke', 'كاريوكي')) p.captions.style = 'karaoke';
    else if (has('green box', 'green', 'vert', 'أخضر', 'khder')) p.captions.style = 'green_box';
    else if (has('purple', 'violet', 'بنفسجي')) p.captions.style = 'purple_box';
    else if (has('neon', 'néon', 'نيون')) p.captions.style = 'neon';
    else if (has('comic', 'cartoon', 'مضحك')) p.captions.style = 'comic';
    else if (has('clean', 'simple', 'minimal', 'white', 'blanc', 'بسيط', 'أبيض', 'byad')) p.captions.style = 'clean';
    else if (has('podcast', 'بودكاست')) p.captions.style = 'podcast';
    const langs: [string, string[]][] = [['ar', ['arabic', 'arabe', 'العربية', 'عربية', 'عربي', 'darija', 'الدارجة', 'bel 3arbiya', 'b l3arbiya', 'l3arbiya', '3arbiya']], ['fr', ['french', 'français', 'francais', 'الفرنسية', 'فرنسية', 'fransawiya', 'b lfrancais', 'lfrancais']], ['en', ['english', 'anglais', 'الإنجليزية', 'الانجليزية', 'إنجليزية', 'انجليزية', 'negliziya', 'ngliziya']], ['es', ['spanish', 'espagnol', 'español', 'الإسبانية']], ['de', ['german', 'allemand', 'deutsch']], ['it', ['italian', 'italien']], ['tr', ['turkish', 'turc']]];
    for (const [code, words] of langs) if (has(...words)) { p.captions.language = code; break; }
  }

  // music
  if (has('music', 'musique', 'موسيقى', 'musika', 'mosi9a', 'mousi9a', 'song', 'chanson', 'soundtrack', 'beat ', 'track', 'أغنية', 'ghniya', 'lo-fi', 'lofi', 'trap', 'edm', 'hip hop', 'hip-hop', 'jazz', 'rock', 'synthwave', 'ambient', 'cinematic score')) p.music.enabled = !neg('music') && !neg('musique') && !neg('موسيقى') && !neg('musika');
  if (p.music.enabled) {
    const genreWords: [string, string[]][] = [['Trap', ['trap', 'drill', '808']], ['Lo-fi', ['lo-fi', 'lofi', 'study', 'chillhop']], ['Hip-hop', ['hip hop', 'hip-hop', 'hiphop', ' rap ', ' rap,', ' rap.']], ['EDM', ['edm', 'electro', 'dance', 'club', 'techno', 'house']], ['Pop', ['pop ', 'upbeat', 'happy']], ['Cinematic', ['cinematic', 'cinématique', 'epic', 'épique', 'trailer', 'orchestr', 'ملحمي']], ['Ambient', ['ambient', 'ambiance', 'calm', 'relax', 'meditation', 'هادئة']], ['Synthwave', ['synthwave', 'retro wave', 'retrowave', '80s', 'vaporwave']], ['Funk', ['funk', 'funky', 'groove']], ['Rock', ['rock', 'guitar', 'metal']], ['Acoustic', ['acoustic', 'acoustique', 'guitare', 'folk']], ['Jazz', ['jazz', 'swing']]];
    for (const [g, words] of genreWords) if (has(...words) && (GENRES as string[]).includes(g)) { p.music.genre = g; break; }
    const moodWords: [string, string[]][] = [['Energetic', ['energetic', 'énergique', 'hype', 'intense', 'fast', 'sri3', 'zarba', 'حماسية', 'حماسي', 'حماس', 'nachta', 'nachita']], ['Chill', ['chill', 'relax', 'calm', 'hadi', 'هادئ']], ['Happy', ['happy', 'joyeux', 'fun', 'fr7an', 'فرحان', 'cheerful']], ['Dark', ['dark', 'sombre', 'moody', 'k7al', 'مظلم']], ['Epic', ['epic', 'épique', 'ملحمي', 'heroic']], ['Sad', ['sad', 'triste', 'حزين', '7zin', 'emotional', 'émotion']], ['Romantic', ['romantic', 'romantique', 'love', 'رومانسي', 'amour', '7ob']], ['Funny', ['funny', 'drôle', 'comedy', 'مضحك', 'd7k']], ['Inspiring', ['inspir', 'motivat', 'ملهم', 'تحفيز']], ['Tense', ['tense', 'suspense', 'thriller', 'horror', 'خوف', 'رعب']]];
    for (const [m, words] of moodWords) if (has(...words) && (MOODS as string[]).includes(m)) { p.music.mood = m; break; }
    if (!p.music.genre && !p.music.mood) p.music.mood = p.pace === 'fast' ? 'Energetic' : p.pace === 'slow' ? 'Chill' : null;
    if (has('loud music', 'musique forte')) p.music.volume = 0.6;
    if (has('background music', 'musique de fond', 'soft music', 'low music', 'موسيقى خفيفة', 'khfifa')) p.music.volume = 0.25;
  }
  // beat sync / loudness / stabilize / reframe / zoom punches
  p.beatSync = p.music.enabled && has('beat', 'rhythm', 'rythme', 'sync', 'إيقاع', 'on the beat', '3la l beat', 'm3a lbeat');
  p.loudness = has('loudness', 'normalize', 'normalis', 'volume', 'louder', 'plus fort', 'sawt', 'الصوت', 'audio level', 'audio fix', 'fix audio', 'fix the audio', 'sl7 sawt', 'sle7 sawt');
  p.stabilize = has('stabiliz', 'stabilis', 'shaky', 'tremble', 'ثبت', 'اهتزاز', 'tetre3ed', 'kathez');
  p.zoomPunches = has('zoom', 'punch', 'dynamic', 'dynamique', 'زوم', 'energetic', 'énergique') || (p.pace === 'fast' && p.aspect === '9:16');
  p.reframe = has('reframe', 'recadr', 'auto crop', 'recentre', 'follow', 'تتبع', 'إعادة تأطير') || (p.aspect === '9:16' && ctx.videoClips.some((v) => v.width > v.height));

  // color
  const colorWords: [string, string[]][] = [['bw_noir', ['black and white', 'black & white', 'noir et blanc', 'b&w', 'bw ', 'monochrome', 'أبيض وأسود', 'byad o k7al']], ['vin_vhs', ['vhs look', 'vhs color', 'camcorder']], ['vin_faded', ['vintage', 'retro', 'old school', 'faded', 'رجعي', '9dim', 'qdim', 'ancien']], ['vin_warm', ['warm vintage', 'film look', 'kodak']], ['cine_teal', ['teal', 'orange and teal', 'teal orange', 'cinematic color', 'cinematic look', 'cinematic grade', 'hollywood']], ['cine_dark', ['dark', 'moody', 'sombre', 'مظلم', 'k7al', 'night']], ['cine_matte', ['matte', 'flat', 'soft look']], ['mood_golden', ['golden', 'sunset', 'doré', 'ذهبي', 'dhbi', 'warm']], ['mood_blue', ['cold', 'froid', 'blue', 'bleu', 'أزرق', 'bard']], ['vib_summer', ['summer', 'été', 'صيف', 'sif', 'beach', 'plage']], ['vib_food', ['food', 'nourriture', 'ماكلة', 'makla', 'cooking', 'recipe']], ['vib_pop', ['vibrant', 'vivid', 'colorful', 'coloré', 'saturated', 'pop colors', 'ملون', 'mlowen', 'bright colors']], ['vib_hdr', ['hdr', 'crisp', 'sharp look']], ['cre_cyber', ['cyberpunk', 'cyber', 'neon look']], ['mood_horror', ['horror', 'scary', 'horreur', 'رعب', 'khal3a']], ['mood_pastel', ['pastel', 'soft colors', 'aesthetic']]];
  for (const [id, words] of colorWords) if (has(...words) && getColorPreset(id)) { p.color.preset = id; break; }
  if (!p.color.preset && has('cinematic', 'cinématique', 'سينمائي', 'film')) p.color.preset = 'cine_teal';
  p.color.auto = has('auto color', 'fix color', 'fix the color', 'correct color', 'color correct', 'corrige les couleurs', 'couleurs', 'ألوان', 'sle7 lalwan', 'sl7 lalwan', 'enhance', 'améliore', 'improve', '7ssen', 'حسن', 'better quality') || (!p.color.preset && has('color', 'couleur'));

  // effects
  const fxWords: [string, string[]][] = [['glitch', ['glitch', 'غليتش']], ['vhs', ['vhs', 'camcorder', 'كاميرا قديمة']], ['filmgrain', ['grain', 'film grain', 'grainy', '35mm']], ['lightleak', ['light leak', 'fuite de lumière', 'leak']], ['bloom', ['bloom', 'glow', 'dreamy', 'rêveur']], ['vignette', ['vignette']], ['chromatic', ['chromatic', 'aberration']], ['shake', ['shake', 'camera shake', 'secousse', 'هز']], ['neonedges', ['neon edges', 'neon outline']], ['halftone', ['halftone', 'comic print']], ['crt', ['crt', 'old tv', 'vieille télé']], ['rgbsplit', ['rgb split', 'rgb']], ['kaleidoscope', ['kaleidoscope', 'kaléidoscope']], ['rain', ['rain', 'pluie', 'شتا', 'chta']], ['snow', ['snow', 'neige', 'ثلج', 'telj']], ['sparkle', ['sparkle', 'glitter', 'étincelle', 'لمعان']], ['fisheye', ['fisheye', 'fish eye']], ['mirror', ['mirror', 'miroir', 'مرآة']], ['oldfilm', ['old film', 'vieux film', 'silent movie']], ['pixelate', ['pixel art', 'pixelate', '8-bit', '8 bit']]];
  for (const [id, words] of fxWords) if (has(...words) && getEffect(id) && p.effects.length < 3) p.effects.push(id);

  // transitions
  const trWords: [string, string[]][] = [['zoompunch', ['zoom punch', 'punch in', 'zoom transition']], ['zoomin', ['zoom in', 'zoom']], ['glitch', ['glitch transition', 'glitch cut']], ['whippan', ['whip', 'whip pan', 'swish']], ['flash', ['flash', 'white flash']], ['slideleft', ['slide', 'glisse']], ['dissolve', ['dissolve', 'fondu', 'crossfade', 'cross fade']], ['fade', ['fade', 'fondu']], ['fadeblack', ['dip to black', 'fade to black']], ['spin', ['spin', 'rotation']], ['cube', ['cube', '3d']], ['lightleak', ['leak transition']], ['beatflash', ['beat flash']], ['smoothslide', ['smooth', 'seamless', 'fluide']]];
  if (has('transition', 'transitions', 'انتقال', 'انتقالات', 'between clips', 'entre les clips')) {
    // pick the transition word closest (before) to the word "transition" so "zoom punches … dissolve transitions" → dissolve
    const anchor = Math.max(b.indexOf('transition'), b.indexOf('انتقال'), b.indexOf('between clips'), b.indexOf('entre les clips'));
    let best: { id: string; d: number } | null = null;
    for (const [id, words] of trWords) {
      if (!getTransition(id)) continue;
      for (const w of words) {
        let idx = -1, from = 0;
        while (true) { const k = b.indexOf(w, from); if (k < 0) break; if (k < anchor || anchor < 0) idx = k; from = k + 1; }
        if (idx < 0) continue;
        const d = anchor < 0 ? 0 : anchor - idx;
        if (!best || d < best.d) best = { id, d };
      }
    }
    if (best) p.transition.type = best.id;
    if (!p.transition.type) p.transition.type = p.pace === 'fast' ? 'zoompunch' : p.pace === 'slow' ? 'dissolve' : 'smoothslide';
    p.transition.duration = p.pace === 'fast' ? 0.35 : p.pace === 'slow' ? 0.8 : 0.5;
  }

  // title & end card
  const q = brief.match(/["“«]([^"”»]{2,80})["”»]/);
  const wantsTitle = has('title', 'titre', 'عنوان', '3onwan', '3enwan', 'headline', 'intro text', 'hook');
  if (q && (wantsTitle || !has('say', 'caption', 'subtitle'))) p.title = { text: q[1].trim(), preset: p.aspect === '16:9' ? 'yt_title' : 'tiktok_bold' };
  else if (wantsTitle) {
    const after = brief.match(/(?:title|titre|عنوان|3onwan|3enwan|hook)\s*[:=\-]?\s*(.{3,60})$/i);
    p.title = { text: after ? after[1].trim() : 'Your title', preset: p.aspect === '16:9' ? 'yt_title' : 'tiktok_bold' };
    if (!after) p.notes.push('No title text found in the brief — placeholder inserted, edit it in the Text panel.');
  }
  if (has('subscribe', 'abonne', 'abonnez', 'follow me', 'follow for more', 'like and', 'تابع', 'اشترك', 'tab3oni', 'tab3o', 'abonniw', 'cta', 'call to action', 'end card', 'outro'))
    p.endCard = { text: has('subscribe', 'abonne', 'اشترك', 'abonniw') ? 'Subscribe for more' : 'Follow for more', preset: 'story_pill' };

  // summary + notes
  const bits: string[] = [];
  if (p.aspect) bits.push(p.aspect === '9:16' ? 'vertical' : p.aspect);
  if (p.targetDuration) bits.push(`≈${Math.round(p.targetDuration)} s`);
  if (p.cut !== 'keep') bits.push(p.cut === 'highlights' ? 'best moments' : 'remove pauses');
  if (p.splitScenes) bits.push('split by scene');
  if (p.captions.enabled) bits.push(`${p.captions.style} captions`);
  if (p.music.enabled) bits.push(`${p.music.genre || p.music.mood || 'auto'} music`);
  if (p.color.preset) bits.push(`${getColorPreset(p.color.preset)?.name} grade`);
  if (p.effects.length) bits.push(p.effects.join('+'));
  if (p.transition.type) bits.push(`${p.transition.type} transitions`);
  if (p.title) bits.push('title');
  p.summary = bits.length ? `Keyword plan: ${bits.join(' · ')}.` : 'Keyword rules did not recognise specific instructions — only defaults will apply. Try a local or API model for free-form briefs.';
  if (!ctx.videoClips.length) p.notes.push('No video clip on the timeline — cutting, captions and reframe steps will be skipped.');
  return p;
}

/** Human-readable list of what a plan will do (for the review UI). */
export function describePlan(p: EditPlan, ctx: ProjectContext): string[] {
  const out: string[] = [];
  if (p.aspect) out.push(`Canvas → ${p.aspect}`);
  if (p.stabilize) out.push('Stabilize shaky footage (level 2)');
  if (p.cut === 'highlights') out.push(`Keep the best moments${p.targetDuration ? ` (≈${Math.round(p.targetDuration)} s)` : ''}`);
  if (p.splitScenes) out.push('Split clips at scene changes');
  if (p.cut === 'silence') out.push('Remove silences');
  if (p.cut === 'jumpcut') out.push('Jump-cut pauses (tight)');
  if (p.speed) out.push(`Speed ${p.speed}×`);
  if (p.reframe) out.push('Auto-reframe to keep the subject in frame');
  if (p.music.enabled) out.push(`Add ${[p.music.mood, p.music.genre].filter(Boolean).join(' ') || 'matching'} music at ${Math.round(p.music.volume * 100)}%${p.music.duck ? ' with ducking' : ''}`);
  if (p.beatSync) out.push('Cut clips on the beat');
  if (p.transition.type) out.push(`${p.transition.type} transitions (${p.transition.duration}s)`);
  if (p.color.auto) out.push('Auto color correction');
  if (p.color.preset) out.push(`Color grade: ${getColorPreset(p.color.preset)?.name}`);
  for (const f of p.effects) out.push(`Effect: ${getEffect(f)?.name || f}`);
  if (p.zoomPunches) out.push('Zoom punches for energy');
  if (p.captions.enabled) out.push(`Auto captions (${p.captions.style}${p.captions.language ? `, ${p.captions.language}` : ''}) — Whisper`);
  if (p.title) out.push(`Title "${p.title.text}"`);
  if (p.endCard) out.push(`End card "${p.endCard.text}"`);
  if (p.loudness) out.push('Normalize loudness to −14 LUFS');
  if (!out.length) out.push('Nothing to do');
  if (!ctx.videoClips.length) out.push('(no video clips on the timeline)');
  return out;
}
