/**
 * Sound effects library.
 *  - 750 real recorded/produced samples by Kenney (CC0 1.0, public domain) shipped in public/sfx/ (see sfxSamples.ts)
 *  - ~100 procedurally synthesized sounds (see synth.ts) — royalty-free by construction.
 */
import type { Recipe, Layer } from './synth';
import { SFX_SAMPLE_ROWS } from './sfxSamples';

export type SfxCategory =
  | 'Whoosh' | 'Impact' | 'Transition' | 'UI' | 'Notification' | 'Cartoon' | 'Comedy' | 'Horror' | 'Sci-Fi' | 'Nature'
  | 'Weather' | 'Animals' | 'Human' | 'Vehicles' | 'Weapons' | 'Sports' | 'Music stingers' | 'Gaming' | 'Riser' | 'Glitch'
  | 'Voice' | 'Footsteps' | 'Foley' | 'Casino';

export type SfxSource = 'sample' | 'synth';
export interface SfxDef {
  id: string;
  name: string;
  category: SfxCategory;
  tags: string[];
  /** 'sample' = real recorded/produced file (public/sfx/…), 'synth' = generated in-app with Web Audio */
  source: SfxSource;
  /** approximate length in seconds (for display) */
  duration: number;
  /** relative URL under the app base for sample sounds (e.g. "sfx/impact-sounds/impactwood-heavy-000.ogg") */
  url?: string;
  /** synth recipe for generated sounds */
  recipe?: Recipe;
  /** author / pack credit */
  credit?: string;
}
export const SFX_CATEGORIES: SfxCategory[] = ['Impact', 'Whoosh', 'Transition', 'Riser', 'UI', 'Notification', 'Glitch', 'Voice', 'Footsteps', 'Foley', 'Cartoon', 'Comedy', 'Horror', 'Sci-Fi', 'Gaming', 'Casino', 'Music stingers', 'Nature', 'Weather', 'Animals', 'Human', 'Vehicles', 'Weapons', 'Sports'];

const L = (l: Layer) => l;
const recipeDuration = (r: Recipe) => r.duration * (r.repeat ? r.repeat.n : 1) + (r.reverb ? 0.5 : 0);
const def = (id: string, name: string, category: SfxCategory, tags: string[], recipe: Recipe): SfxDef => ({ id, name, category, tags, recipe, source: 'synth', duration: recipeDuration(recipe) });
const noiseSweep = (dur: number, f0: number, f1: number, q = 1.5, gain = 0.6, pink = false): Layer => L({ wave: pink ? 'pink' : 'noise', a: dur * 0.3, d: dur * 0.2, s: 0.8, r: dur * 0.4, gain, filter: { type: 'bandpass', f: [f0, f1], q } });
const thump = (f0 = 120, f1 = 35, dur = 0.5, gain = 0.9): Layer => L({ wave: 'sine', f: [f0, f1], a: 0.002, d: dur * 0.6, s: 0.1, r: dur * 0.3, gain, dur });
const click = (f = 2000, dur = 0.03, gain = 0.4): Layer => L({ wave: 'square', f: [f, f * 0.7], a: 0.001, d: dur, s: 0, r: 0.01, gain, dur });
const tone = (f0: number, f1: number, dur: number, wave: Layer['wave'] = 'sine', gain = 0.4, at = 0): Layer => L({ wave, f: [f0, f1], a: 0.01, d: dur * 0.5, s: 0.5, r: dur * 0.4, gain, dur, at });

/** Procedurally generated sounds */
export const SFX_SYNTH: SfxDef[] = [
  // Whoosh
  def('whoosh_fast', 'Fast whoosh', 'Whoosh', ['swipe', 'swish', 'fast'], { duration: 0.4, layers: [noiseSweep(0.4, 300, 4000, 2, 0.7)] }),
  def('whoosh_deep', 'Deep whoosh', 'Whoosh', ['cinematic', 'low'], { duration: 0.9, layers: [noiseSweep(0.9, 80, 900, 1.2, 0.8, true)], reverb: 0.3 }),
  def('whoosh_airy', 'Airy swish', 'Whoosh', ['soft', 'light'], { duration: 0.6, layers: [noiseSweep(0.6, 2000, 6000, 3, 0.4)] }),
  def('whoosh_reverse', 'Reverse whoosh', 'Whoosh', ['reverse', 'suck'], { duration: 0.7, layers: [L({ wave: 'noise', a: 0.6, d: 0.05, s: 1, r: 0.05, gain: 0.7, filter: { type: 'bandpass', f: [200, 5000], q: 2 } })] }),
  def('whoosh_double', 'Double swipe', 'Whoosh', ['double', 'ui'], { duration: 0.5, layers: [noiseSweep(0.25, 400, 3000, 2, 0.6), { ...noiseSweep(0.25, 600, 3500, 2, 0.5), at: 0.22 }] }),
  // Impact
  def('impact_boom', 'Cinematic boom', 'Impact', ['trailer', 'hit', 'bass'], { duration: 2, layers: [thump(90, 30, 1.6, 1), L({ wave: 'pink', a: 0.005, d: 0.4, s: 0.2, r: 1, gain: 0.5, filter: { type: 'lowpass', f: [800, 120] } })], reverb: 0.8 }),
  def('impact_punch', 'Punch', 'Impact', ['hit', 'fight'], { duration: 0.4, layers: [thump(150, 50, 0.3, 0.9), L({ wave: 'noise', a: 0.001, d: 0.08, s: 0, r: 0.05, gain: 0.5, filter: { type: 'lowpass', f: [2000, 300] } })] }),
  def('impact_metal', 'Metal hit', 'Impact', ['clang', 'metal'], { duration: 1.2, layers: [tone(1200, 1150, 1.2, 'square', 0.25), tone(1830, 1800, 1, 'sawtooth', 0.15), tone(2700, 2650, 0.7, 'square', 0.1), click(4000, 0.02, 0.5)], reverb: 0.4 }),
  def('impact_glass', 'Glass shatter', 'Impact', ['break', 'glass'], { duration: 0.9, layers: [L({ wave: 'noise', a: 0.001, d: 0.3, s: 0.1, r: 0.5, gain: 0.6, filter: { type: 'highpass', f: [3000, 6000], q: 2 } }), tone(5200, 4800, 0.4, 'triangle', 0.15), tone(7100, 6900, 0.3, 'triangle', 0.1, 0.05)] }),
  def('impact_thud', 'Thud', 'Impact', ['drop', 'body'], { duration: 0.5, layers: [thump(80, 30, 0.45, 0.9), L({ wave: 'pink', a: 0.002, d: 0.1, s: 0, r: 0.1, gain: 0.3, filter: { type: 'lowpass', f: [500, 100] } })] }),
  def('impact_sub', 'Sub drop', 'Impact', ['bass', 'drop', 'edm'], { duration: 1.5, layers: [L({ wave: 'sine', f: [160, 28], a: 0.01, d: 1, s: 0.3, r: 0.4, gain: 1, sweep: 'exp' })] }),
  // Transition
  def('trans_swoosh_hit', 'Swoosh + hit', 'Transition', ['cut', 'edit'], { duration: 1, layers: [noiseSweep(0.5, 300, 5000, 2, 0.6), { ...thump(120, 40, 0.5, 0.9), at: 0.45 }], reverb: 0.3 }),
  def('trans_riser_hit', 'Riser to hit', 'Transition', ['build', 'drop'], { duration: 1.6, layers: [L({ wave: 'sawtooth', f: [100, 800], a: 1, d: 0.1, s: 1, r: 0.05, gain: 0.3, dur: 1.15, filter: { type: 'lowpass', f: [300, 4000] } }), L({ wave: 'noise', a: 1, d: 0.1, s: 1, r: 0.05, gain: 0.4, dur: 1.15, filter: { type: 'highpass', f: [200, 3000] } }), { ...thump(140, 35, 0.5, 1), at: 1.15 }], reverb: 0.4 }),
  def('trans_tape_stop', 'Tape stop', 'Transition', ['stop', 'slow'], { duration: 0.9, layers: [L({ wave: 'sawtooth', f: [220, 20], a: 0.01, d: 0.2, s: 0.8, r: 0.3, gain: 0.3, filter: { type: 'lowpass', f: [3000, 200] } }), L({ wave: 'square', f: [330, 30], a: 0.01, d: 0.2, s: 0.6, r: 0.3, gain: 0.15 })] }),
  def('trans_zap', 'Zap', 'Transition', ['electric', 'fast'], { duration: 0.3, layers: [L({ wave: 'square', f: [1800, 200], a: 0.002, d: 0.1, s: 0.3, r: 0.15, gain: 0.35 }), L({ wave: 'noise', a: 0.001, d: 0.05, s: 0.2, r: 0.2, gain: 0.3, filter: { type: 'highpass', f: [2000, 2000] } })] }),
  def('trans_shimmer', 'Shimmer', 'Transition', ['magic', 'sparkle'], { duration: 1.4, layers: [tone(1760, 1760, 1.2, 'sine', 0.15), tone(2217, 2217, 1.1, 'sine', 0.12, 0.08), tone(2637, 2637, 1, 'sine', 0.1, 0.16), tone(3520, 3520, 0.9, 'sine', 0.08, 0.24), L({ wave: 'noise', a: 0.3, d: 0.3, s: 0.5, r: 0.6, gain: 0.12, filter: { type: 'highpass', f: [6000, 9000] } })], reverb: 0.7 }),
  // Riser
  def('riser_noise', 'Noise riser', 'Riser', ['build', 'tension'], { duration: 3, layers: [L({ wave: 'noise', a: 2.7, d: 0.1, s: 1, r: 0.2, gain: 0.6, filter: { type: 'lowpass', f: [200, 8000], q: 1.5 } })] }),
  def('riser_synth', 'Synth riser', 'Riser', ['edm', 'pitch'], { duration: 2.5, layers: [L({ wave: 'sawtooth', f: [110, 880], a: 2.3, d: 0.05, s: 1, r: 0.15, gain: 0.3, filter: { type: 'lowpass', f: [400, 6000] } }), L({ wave: 'sawtooth', f: [110.5, 884], a: 2.3, d: 0.05, s: 1, r: 0.15, gain: 0.25, detune: 12 })] }),
  def('riser_tension', 'Tension drone rise', 'Riser', ['horror', 'cinematic'], { duration: 4, layers: [L({ wave: 'sawtooth', f: [55, 110], a: 3.5, d: 0.1, s: 1, r: 0.3, gain: 0.35, filter: { type: 'lowpass', f: [200, 1800] }, vib: [3, 6] }), L({ wave: 'pink', a: 3.5, d: 0.1, s: 1, r: 0.3, gain: 0.3, filter: { type: 'bandpass', f: [300, 3000], q: 2 } })], reverb: 0.6 }),
  def('riser_uplifter', 'Uplifter', 'Riser', ['short', 'pop'], { duration: 1.2, layers: [L({ wave: 'noise', a: 1, d: 0.05, s: 1, r: 0.1, gain: 0.5, filter: { type: 'bandpass', f: [500, 7000], q: 2 } }), L({ wave: 'triangle', f: [400, 1600], a: 1, d: 0.05, s: 1, r: 0.1, gain: 0.15 })] }),
  // UI
  def('ui_click', 'Click', 'UI', ['button', 'tap'], { duration: 0.08, layers: [click(1800, 0.03, 0.5), tone(900, 700, 0.06, 'sine', 0.3)] }),
  def('ui_pop', 'Pop', 'UI', ['bubble'], { duration: 0.15, layers: [L({ wave: 'sine', f: [600, 150], a: 0.002, d: 0.1, s: 0, r: 0.03, gain: 0.6 })] }),
  def('ui_tick', 'Tick', 'UI', ['toggle', 'switch'], { duration: 0.05, layers: [click(3000, 0.015, 0.5)] }),
  def('ui_swipe', 'Swipe', 'UI', ['scroll'], { duration: 0.25, layers: [noiseSweep(0.25, 1500, 4000, 3, 0.35)] }),
  def('ui_error', 'Error', 'UI', ['wrong', 'deny'], { duration: 0.4, layers: [tone(300, 300, 0.15, 'square', 0.25), tone(220, 220, 0.2, 'square', 0.25, 0.18)] }),
  def('ui_success', 'Success', 'UI', ['done', 'confirm'], { duration: 0.5, layers: [tone(660, 660, 0.12, 'sine', 0.35), tone(880, 880, 0.12, 'sine', 0.35, 0.12), tone(1320, 1320, 0.25, 'sine', 0.35, 0.24)] }),
  def('ui_typing', 'Keyboard typing', 'UI', ['keys', 'type'], { duration: 1.2, layers: [click(2500, 0.02, 0.35), { ...click(2200, 0.02, 0.3), at: 0.11 }, { ...click(2700, 0.02, 0.35), at: 0.25 }, { ...click(2300, 0.02, 0.3), at: 0.33 }, { ...click(2600, 0.02, 0.35), at: 0.48 }, { ...click(2400, 0.02, 0.3), at: 0.6 }, { ...click(2500, 0.02, 0.3), at: 0.72 }, { ...click(2250, 0.02, 0.35), at: 0.9 }, { ...click(2650, 0.02, 0.3), at: 1.02 }] }),
  // Notification
  def('notif_ding', 'Ding', 'Notification', ['bell', 'alert'], { duration: 1.2, layers: [tone(1318, 1318, 1.1, 'sine', 0.4), tone(2637, 2637, 0.6, 'sine', 0.12), tone(3951, 3951, 0.3, 'sine', 0.06)], reverb: 0.3 }),
  def('notif_chime', 'Chime', 'Notification', ['message', 'two-tone'], { duration: 0.8, layers: [tone(1046, 1046, 0.4, 'sine', 0.35), tone(1568, 1568, 0.5, 'sine', 0.35, 0.18)], reverb: 0.3 }),
  def('notif_bubble', 'Message bubble', 'Notification', ['chat', 'text'], { duration: 0.3, layers: [L({ wave: 'sine', f: [500, 900], a: 0.01, d: 0.1, s: 0.3, r: 0.1, gain: 0.4, sweep: 'exp' }), L({ wave: 'sine', f: [900, 1300], a: 0.01, d: 0.1, s: 0.3, r: 0.1, gain: 0.3, at: 0.12, dur: 0.18 })] }),
  def('notif_alarm', 'Alarm', 'Notification', ['alert', 'warning'], { duration: 1.2, layers: [tone(880, 880, 0.15, 'square', 0.25), tone(880, 880, 0.15, 'square', 0.25, 0.3), tone(880, 880, 0.15, 'square', 0.25, 0.6), tone(880, 880, 0.15, 'square', 0.25, 0.9)] }),
  def('notif_coin', 'Coin', 'Notification', ['money', 'reward'], { duration: 0.5, layers: [tone(988, 988, 0.1, 'square', 0.25), tone(1319, 1319, 0.4, 'square', 0.25, 0.1)] }),
  // Glitch
  def('glitch_short', 'Glitch burst', 'Glitch', ['digital', 'error'], { duration: 0.35, layers: [L({ wave: 'square', f: [1200, 300], a: 0.001, d: 0.03, s: 0.5, r: 0.02, gain: 0.3, dur: 0.06 }), L({ wave: 'square', f: [400, 2000], a: 0.001, d: 0.03, s: 0.5, r: 0.02, gain: 0.3, at: 0.08, dur: 0.05 }), L({ wave: 'noise', a: 0.001, d: 0.04, s: 0.3, r: 0.02, gain: 0.35, at: 0.15, dur: 0.07, filter: { type: 'bandpass', f: [3000, 3000], q: 5 } }), L({ wave: 'sawtooth', f: [90, 90], a: 0.001, d: 0.05, s: 0.5, r: 0.02, gain: 0.3, at: 0.24, dur: 0.1 })] }),
  def('glitch_static', 'Static', 'Glitch', ['tv', 'noise'], { duration: 1, layers: [L({ wave: 'noise', a: 0.01, d: 0.1, s: 0.8, r: 0.1, gain: 0.35, filter: { type: 'bandpass', f: [1500, 2500], q: 0.7 } })] }),
  def('glitch_data', 'Data stream', 'Glitch', ['computer', 'hacker'], { duration: 1.2, layers: Array.from({ length: 16 }, (_, i) => L({ wave: 'square', f: [400 + ((i * 733) % 2000), 400 + ((i * 733) % 2000)], a: 0.001, d: 0.02, s: 0.4, r: 0.01, gain: 0.15, at: i * 0.07, dur: 0.05 })) }),
  def('glitch_stutter', 'Stutter', 'Glitch', ['beat', 'repeat'], { duration: 0.8, layers: Array.from({ length: 8 }, (_, i) => L({ wave: 'sawtooth', f: [220, 180], a: 0.001, d: 0.05, s: 0, r: 0.02, gain: 0.3, at: i * 0.1, dur: 0.07, filter: { type: 'lowpass', f: [3000, 500] } })) }),
  // Cartoon
  def('cartoon_boing', 'Boing', 'Cartoon', ['spring', 'bounce'], { duration: 0.7, layers: [L({ wave: 'sine', f: [500, 120], a: 0.005, d: 0.3, s: 0.4, r: 0.3, gain: 0.5, vib: [60, 18] })] }),
  def('cartoon_slide_whistle', 'Slide whistle up', 'Cartoon', ['whistle', 'rise'], { duration: 0.8, layers: [L({ wave: 'sine', f: [400, 1600], a: 0.02, d: 0.1, s: 0.9, r: 0.1, gain: 0.4, vib: [10, 6] })] }),
  def('cartoon_slide_down', 'Slide whistle down', 'Cartoon', ['whistle', 'fall'], { duration: 0.9, layers: [L({ wave: 'sine', f: [1500, 300], a: 0.02, d: 0.1, s: 0.9, r: 0.1, gain: 0.4, vib: [10, 6] })] }),
  def('cartoon_pop', 'Cork pop', 'Cartoon', ['pop', 'bottle'], { duration: 0.2, layers: [L({ wave: 'sine', f: [300, 80], a: 0.001, d: 0.12, s: 0, r: 0.05, gain: 0.8 }), click(1200, 0.01, 0.3)] }),
  def('cartoon_bonk', 'Bonk', 'Cartoon', ['head', 'hit'], { duration: 0.35, layers: [L({ wave: 'triangle', f: [700, 200], a: 0.002, d: 0.2, s: 0, r: 0.1, gain: 0.6 }), thump(200, 60, 0.2, 0.5)] }),
  def('cartoon_twinkle', 'Twinkle', 'Cartoon', ['magic', 'star'], { duration: 1, layers: [tone(2093, 2093, 0.2, 'sine', 0.25), tone(2637, 2637, 0.2, 'sine', 0.25, 0.1), tone(3136, 3136, 0.2, 'sine', 0.25, 0.2), tone(4186, 4186, 0.5, 'sine', 0.25, 0.3)], reverb: 0.5 }),
  // Comedy
  def('comedy_fail', 'Sad trombone', 'Comedy', ['fail', 'womp'], { duration: 2.2, layers: [tone(233, 220, 0.45, 'sawtooth', 0.3), tone(220, 208, 0.45, 'sawtooth', 0.3, 0.5), tone(208, 196, 0.45, 'sawtooth', 0.3, 1), L({ wave: 'sawtooth', f: [196, 150], a: 0.02, d: 0.3, s: 0.7, r: 0.3, gain: 0.3, at: 1.5, dur: 0.7, vib: [6, 5] })].map((l) => ({ ...l, filter: { type: 'lowpass' as const, f: [1200, 1200] as [number, number] } })) }),
  def('comedy_rimshot', 'Rimshot', 'Comedy', ['ba-dum-tss', 'drum'], { duration: 1, layers: [thump(180, 60, 0.15, 0.8), { ...thump(180, 60, 0.15, 0.8), at: 0.18 }, L({ wave: 'noise', a: 0.001, d: 0.3, s: 0.1, r: 0.4, gain: 0.5, at: 0.36, filter: { type: 'highpass', f: [5000, 5000] } })] }),
  def('comedy_crickets', 'Crickets', 'Comedy', ['silence', 'awkward'], { duration: 2.5, layers: Array.from({ length: 10 }, (_, i) => L({ wave: 'sine', f: [4200, 4200], a: 0.01, d: 0.05, s: 0.5, r: 0.03, gain: 0.12, at: i * 0.25 + (i % 2) * 0.05, dur: 0.09, vib: [200, 60] })) }),
  def('comedy_record_scratch', 'Record scratch', 'Comedy', ['stop', 'dj'], { duration: 0.5, layers: [L({ wave: 'noise', a: 0.01, d: 0.1, s: 0.6, r: 0.1, gain: 0.5, filter: { type: 'bandpass', f: [3000, 600], q: 4 } }), L({ wave: 'sawtooth', f: [800, 150], a: 0.01, d: 0.2, s: 0.4, r: 0.1, gain: 0.2 })] }),
  def('comedy_honk', 'Clown horn', 'Comedy', ['honk', 'horn'], { duration: 0.5, layers: [tone(330, 320, 0.45, 'sawtooth', 0.25), tone(415, 400, 0.45, 'square', 0.15)].map((l) => ({ ...l, filter: { type: 'lowpass' as const, f: [1500, 1500] as [number, number] } })) }),
  // Horror
  def('horror_drone', 'Dark drone', 'Horror', ['ambient', 'tension'], { duration: 5, layers: [L({ wave: 'sawtooth', f: [48, 50], a: 1.5, d: 0.5, s: 0.9, r: 1.5, gain: 0.3, filter: { type: 'lowpass', f: [300, 500] }, vib: [1.5, 0.3] }), L({ wave: 'sine', f: [97, 95], a: 2, d: 0.5, s: 0.8, r: 1.5, gain: 0.25 })], reverb: 0.9 }),
  def('horror_stinger', 'Jump scare stinger', 'Horror', ['scare', 'hit'], { duration: 1.8, layers: [L({ wave: 'sawtooth', f: [1200, 900], a: 0.002, d: 0.5, s: 0.3, r: 0.8, gain: 0.3, filter: { type: 'bandpass', f: [2000, 800], q: 3 } }), L({ wave: 'noise', a: 0.001, d: 0.3, s: 0.2, r: 0.8, gain: 0.5, filter: { type: 'highpass', f: [1000, 3000] } }), thump(100, 30, 1, 0.9)], reverb: 0.8 }),
  def('horror_whisper', 'Whisper wind', 'Horror', ['wind', 'eerie'], { duration: 3, layers: [L({ wave: 'pink', a: 1, d: 0.5, s: 0.8, r: 1.2, gain: 0.3, filter: { type: 'bandpass', f: [400, 1800], q: 3 }, vib: [0, 0] })], reverb: 0.6 }),
  def('horror_heartbeat', 'Heartbeat', 'Horror', ['pulse', 'slow'], { duration: 2.4, layers: [thump(70, 40, 0.25, 0.9), { ...thump(60, 35, 0.3, 0.7), at: 0.3 }, { ...thump(70, 40, 0.25, 0.9), at: 1.2 }, { ...thump(60, 35, 0.3, 0.7), at: 1.5 }] }),
  // Sci-Fi
  def('scifi_laser', 'Laser', 'Sci-Fi', ['pew', 'shot'], { duration: 0.35, layers: [L({ wave: 'sawtooth', f: [2400, 200], a: 0.002, d: 0.15, s: 0.2, r: 0.1, gain: 0.35 }), L({ wave: 'sine', f: [1800, 300], a: 0.002, d: 0.15, s: 0.2, r: 0.1, gain: 0.3 })] }),
  def('scifi_teleport', 'Teleport', 'Sci-Fi', ['warp', 'beam'], { duration: 1.4, layers: [L({ wave: 'sine', f: [200, 2400], a: 0.3, d: 0.2, s: 0.7, r: 0.5, gain: 0.3, vib: [40, 25] }), L({ wave: 'noise', a: 0.4, d: 0.2, s: 0.6, r: 0.6, gain: 0.25, filter: { type: 'bandpass', f: [800, 6000], q: 2 } })], reverb: 0.5 }),
  def('scifi_powerup', 'Power up', 'Sci-Fi', ['charge', 'energy'], { duration: 1.2, layers: [L({ wave: 'square', f: [150, 1200], a: 0.05, d: 0.2, s: 0.8, r: 0.2, gain: 0.25, filter: { type: 'lowpass', f: [600, 5000] } }), L({ wave: 'sine', f: [300, 2400], a: 0.05, d: 0.2, s: 0.8, r: 0.2, gain: 0.2 })] }),
  def('scifi_computer', 'Computer beeps', 'Sci-Fi', ['beep', 'console'], { duration: 1.1, layers: [tone(1200, 1200, 0.08, 'square', 0.15), tone(1600, 1600, 0.08, 'square', 0.15, 0.15), tone(1000, 1000, 0.08, 'square', 0.15, 0.3), tone(1800, 1800, 0.08, 'square', 0.15, 0.5), tone(1400, 1400, 0.08, 'square', 0.15, 0.7), tone(2000, 2000, 0.2, 'square', 0.15, 0.85)] }),
  def('scifi_engine', 'Spaceship hum', 'Sci-Fi', ['engine', 'loop'], { duration: 4, layers: [L({ wave: 'sawtooth', f: [60, 62], a: 0.5, d: 0.3, s: 0.9, r: 0.8, gain: 0.25, filter: { type: 'lowpass', f: [400, 500] } }), L({ wave: 'square', f: [120, 121], a: 0.5, d: 0.3, s: 0.9, r: 0.8, gain: 0.1, filter: { type: 'lowpass', f: [800, 800] }, vib: [4, 0.5] })] }),
  // Gaming
  def('game_jump', '8-bit jump', 'Gaming', ['retro', 'platformer'], { duration: 0.3, layers: [L({ wave: 'square', f: [300, 900], a: 0.002, d: 0.15, s: 0.3, r: 0.1, gain: 0.25, sweep: 'lin' })] }),
  def('game_coin', '8-bit coin', 'Gaming', ['retro', 'pickup'], { duration: 0.4, layers: [tone(988, 988, 0.08, 'square', 0.2), tone(1319, 1319, 0.3, 'square', 0.2, 0.08)] }),
  def('game_powerup', '8-bit power up', 'Gaming', ['retro', 'level'], { duration: 0.7, layers: Array.from({ length: 8 }, (_, i) => L({ wave: 'square', f: [440 * Math.pow(2, i / 6), 440 * Math.pow(2, i / 6)], a: 0.002, d: 0.05, s: 0.5, r: 0.02, gain: 0.2, at: i * 0.08, dur: 0.08 })) }),
  def('game_hurt', '8-bit hurt', 'Gaming', ['retro', 'damage'], { duration: 0.35, layers: [L({ wave: 'square', f: [600, 120], a: 0.002, d: 0.2, s: 0.2, r: 0.1, gain: 0.25 }), L({ wave: 'noise', a: 0.002, d: 0.1, s: 0, r: 0.05, gain: 0.15 })] }),
  def('game_gameover', 'Game over', 'Gaming', ['retro', 'lose'], { duration: 1.6, layers: [tone(440, 440, 0.3, 'square', 0.2), tone(415, 415, 0.3, 'square', 0.2, 0.3), tone(392, 392, 0.3, 'square', 0.2, 0.6), tone(370, 300, 0.6, 'square', 0.2, 0.9)] }),
  def('game_victory', 'Victory fanfare', 'Gaming', ['win', 'retro'], { duration: 1.6, layers: [tone(523, 523, 0.15, 'square', 0.2), tone(659, 659, 0.15, 'square', 0.2, 0.15), tone(784, 784, 0.15, 'square', 0.2, 0.3), tone(1047, 1047, 0.5, 'square', 0.2, 0.45), tone(784, 784, 0.15, 'square', 0.2, 0.95), tone(1047, 1047, 0.5, 'square', 0.25, 1.1)] }),
  def('game_headshot', 'Headshot ding', 'Gaming', ['fps', 'hit'], { duration: 0.4, layers: [tone(2500, 2500, 0.35, 'sine', 0.35), tone(3750, 3750, 0.2, 'sine', 0.15), click(3000, 0.02, 0.4)] }),
  // Music stingers
  def('sting_orch_hit', 'Orchestra hit', 'Music stingers', ['dramatic', 'hit'], { duration: 1.2, layers: [tone(130.8, 130.8, 1, 'sawtooth', 0.25), tone(164.8, 164.8, 1, 'sawtooth', 0.2), tone(196, 196, 1, 'sawtooth', 0.2), tone(261.6, 261.6, 1, 'sawtooth', 0.15), thump(100, 40, 0.5, 0.7)].map((l) => ({ ...l, filter: { type: 'lowpass' as const, f: [4000, 1200] as [number, number] } })), reverb: 0.7 }),
  def('sting_suspense', 'Suspense chord', 'Music stingers', ['mystery', 'minor'], { duration: 2.5, layers: [tone(220, 220, 2.3, 'triangle', 0.2), tone(261.6, 261.6, 2.3, 'triangle', 0.18), tone(311.1, 311.1, 2.3, 'triangle', 0.16), tone(466.2, 466.2, 2.3, 'sine', 0.12)], reverb: 0.8 }),
  def('sting_happy', 'Happy ending', 'Music stingers', ['major', 'outro'], { duration: 2, layers: [tone(261.6, 261.6, 0.25, 'triangle', 0.25), tone(329.6, 329.6, 0.25, 'triangle', 0.25, 0.2), tone(392, 392, 0.25, 'triangle', 0.25, 0.4), tone(523.3, 523.3, 1.3, 'triangle', 0.3, 0.6), tone(659.3, 659.3, 1.3, 'triangle', 0.2, 0.6), tone(784, 784, 1.3, 'triangle', 0.15, 0.6)], reverb: 0.6 }),
  def('sting_dun', 'Dun dun duuun', 'Music stingers', ['drama', 'reveal'], { duration: 2.4, layers: [tone(196, 196, 0.35, 'sawtooth', 0.3), tone(185, 185, 0.35, 'sawtooth', 0.3, 0.45), tone(174.6, 174.6, 1.4, 'sawtooth', 0.35, 0.9), tone(130.8, 130.8, 1.4, 'sawtooth', 0.25, 0.9)].map((l) => ({ ...l, filter: { type: 'lowpass' as const, f: [1500, 1500] as [number, number] } })), reverb: 0.7 }),
  def('sting_logo', 'Logo reveal', 'Music stingers', ['brand', 'intro'], { duration: 2.8, layers: [noiseSweep(1, 200, 6000, 2, 0.4), { ...thump(110, 35, 1, 0.9), at: 1 }, tone(523.3, 523.3, 1.6, 'sine', 0.25, 1), tone(659.3, 659.3, 1.6, 'sine', 0.2, 1.05), tone(784, 784, 1.6, 'sine', 0.15, 1.1), L({ wave: 'noise', a: 0.1, d: 0.5, s: 0.3, r: 1, gain: 0.12, at: 1, filter: { type: 'highpass', f: [6000, 8000] } })], reverb: 0.8 }),
  // Nature
  def('nature_wind', 'Wind', 'Nature', ['breeze', 'outdoor'], { duration: 5, layers: [L({ wave: 'pink', a: 1.5, d: 0.5, s: 0.8, r: 1.5, gain: 0.4, filter: { type: 'lowpass', f: [400, 900], q: 0.8 } }), L({ wave: 'pink', a: 2, d: 1, s: 0.6, r: 1.5, gain: 0.2, filter: { type: 'bandpass', f: [700, 1400], q: 2 } })] }),
  def('nature_stream', 'Stream', 'Nature', ['water', 'river'], { duration: 5, layers: [L({ wave: 'noise', a: 0.5, d: 0.5, s: 0.9, r: 0.8, gain: 0.3, filter: { type: 'bandpass', f: [2500, 2500], q: 0.6 } }), L({ wave: 'pink', a: 0.5, d: 0.5, s: 0.9, r: 0.8, gain: 0.25, filter: { type: 'highpass', f: [600, 600] } })] }),
  def('nature_fire', 'Campfire', 'Nature', ['fire', 'crackle'], { duration: 5, layers: [L({ wave: 'pink', a: 0.5, d: 0.5, s: 0.9, r: 0.8, gain: 0.3, filter: { type: 'lowpass', f: [700, 700] } }), ...Array.from({ length: 14 }, (_, i) => L({ wave: 'noise', a: 0.001, d: 0.02, s: 0, r: 0.01, gain: 0.3, at: 0.2 + i * 0.33 + (i % 3) * 0.1, dur: 0.03, filter: { type: 'highpass', f: [3000, 3000] } }))] }),
  def('nature_ocean', 'Ocean waves', 'Nature', ['sea', 'beach'], { duration: 6, layers: [L({ wave: 'pink', a: 2.5, d: 1, s: 0.3, r: 2.4, gain: 0.5, filter: { type: 'lowpass', f: [300, 1500] } }), L({ wave: 'noise', a: 2.5, d: 1, s: 0.3, r: 2.4, gain: 0.2, filter: { type: 'highpass', f: [1500, 3000] } })] }),
  // Weather
  def('weather_thunder', 'Thunder', 'Weather', ['storm', 'rumble'], { duration: 3.5, layers: [L({ wave: 'pink', a: 0.05, d: 1, s: 0.4, r: 2.2, gain: 0.8, filter: { type: 'lowpass', f: [900, 120] } }), thump(70, 25, 2.5, 0.8)], reverb: 0.8 }),
  def('weather_rain', 'Rain', 'Weather', ['rain', 'loop'], { duration: 5, layers: [L({ wave: 'noise', a: 0.5, d: 0.5, s: 0.9, r: 0.8, gain: 0.3, filter: { type: 'highpass', f: [1800, 1800] } }), L({ wave: 'pink', a: 0.5, d: 0.5, s: 0.9, r: 0.8, gain: 0.15, filter: { type: 'bandpass', f: [900, 900], q: 0.7 } })] }),
  def('weather_lightning', 'Lightning crack', 'Weather', ['strike', 'crack'], { duration: 1.5, layers: [L({ wave: 'noise', a: 0.001, d: 0.08, s: 0.3, r: 0.4, gain: 0.8, filter: { type: 'highpass', f: [2000, 500] } }), L({ wave: 'pink', a: 0.05, d: 0.4, s: 0.3, r: 1, gain: 0.6, at: 0.05, filter: { type: 'lowpass', f: [800, 150] } })], reverb: 0.7 }),
  // Animals
  def('animal_bird', 'Bird chirp', 'Animals', ['tweet', 'bird'], { duration: 0.9, layers: [L({ wave: 'sine', f: [2800, 3600], a: 0.01, d: 0.05, s: 0.6, r: 0.03, gain: 0.3, dur: 0.12, vib: [150, 40] }), L({ wave: 'sine', f: [3200, 2600], a: 0.01, d: 0.05, s: 0.6, r: 0.03, gain: 0.3, at: 0.18, dur: 0.1 }), L({ wave: 'sine', f: [2900, 3800], a: 0.01, d: 0.05, s: 0.6, r: 0.03, gain: 0.3, at: 0.4, dur: 0.14, vib: [200, 50] }), L({ wave: 'sine', f: [3600, 3000], a: 0.01, d: 0.05, s: 0.6, r: 0.03, gain: 0.25, at: 0.62, dur: 0.1 })] }),
  def('animal_dog', 'Dog bark', 'Animals', ['bark', 'woof'], { duration: 0.6, layers: [L({ wave: 'sawtooth', f: [300, 180], a: 0.01, d: 0.12, s: 0.2, r: 0.08, gain: 0.4, dur: 0.22, filter: { type: 'bandpass', f: [700, 400], q: 1.5 } }), L({ wave: 'sawtooth', f: [320, 170], a: 0.01, d: 0.12, s: 0.2, r: 0.08, gain: 0.4, at: 0.3, dur: 0.22, filter: { type: 'bandpass', f: [700, 400], q: 1.5 } })] }),
  def('animal_cat', 'Cat meow', 'Animals', ['meow', 'cat'], { duration: 0.8, layers: [L({ wave: 'sawtooth', f: [500, 900], a: 0.05, d: 0.2, s: 0.7, r: 0.3, gain: 0.25, dur: 0.75, vib: [20, 8], filter: { type: 'bandpass', f: [1200, 1800], q: 2 } }), L({ wave: 'sawtooth', f: [900, 450], a: 0.3, d: 0.2, s: 0.5, r: 0.2, gain: 0.15, at: 0.3, dur: 0.45, filter: { type: 'bandpass', f: [1500, 900], q: 2 } })] }),
  def('animal_frog', 'Frog croak', 'Animals', ['frog', 'pond'], { duration: 0.6, layers: [L({ wave: 'square', f: [90, 70], a: 0.02, d: 0.2, s: 0.5, r: 0.1, gain: 0.3, dur: 0.5, vib: [30, 30], filter: { type: 'lowpass', f: [600, 400] } })] }),
  // Human
  def('human_clap', 'Single clap', 'Human', ['clap', 'hand'], { duration: 0.3, layers: [L({ wave: 'noise', a: 0.001, d: 0.06, s: 0.1, r: 0.15, gain: 0.7, filter: { type: 'bandpass', f: [1500, 1200], q: 1 } })], reverb: 0.3 }),
  def('human_applause', 'Applause', 'Human', ['crowd', 'cheer'], { duration: 4, layers: [L({ wave: 'noise', a: 0.6, d: 1, s: 0.8, r: 1.2, gain: 0.5, filter: { type: 'bandpass', f: [1200, 1600], q: 0.8 } }), ...Array.from({ length: 40 }, (_, i) => L({ wave: 'noise', a: 0.001, d: 0.03, s: 0, r: 0.02, gain: 0.25, at: 0.1 + i * 0.095 + ((i * 37) % 7) * 0.01, dur: 0.04, filter: { type: 'bandpass', f: [1800, 1500], q: 1.5 } }))], reverb: 0.5 }),
  def('human_footsteps', 'Footsteps', 'Human', ['walk', 'steps'], { duration: 2.4, layers: Array.from({ length: 5 }, (_, i) => L({ wave: 'pink', a: 0.002, d: 0.08, s: 0, r: 0.05, gain: 0.5, at: i * 0.5, dur: 0.12, filter: { type: 'lowpass', f: [500, 200] } })) }),
  def('human_heartbeat_fast', 'Fast heartbeat', 'Human', ['pulse', 'nervous'], { duration: 2, layers: Array.from({ length: 4 }, (_, i) => [{ ...thump(75, 40, 0.2, 0.9), at: i * 0.5 }, { ...thump(65, 35, 0.22, 0.7), at: i * 0.5 + 0.2 }]).flat() }),
  def('human_snap', 'Finger snap', 'Human', ['snap', 'click'], { duration: 0.2, layers: [L({ wave: 'noise', a: 0.001, d: 0.03, s: 0, r: 0.05, gain: 0.6, filter: { type: 'bandpass', f: [2500, 2000], q: 2 } }), tone(1100, 700, 0.06, 'sine', 0.3)], reverb: 0.2 }),
  // Vehicles
  def('vehicle_car_pass', 'Car pass-by', 'Vehicles', ['car', 'traffic'], { duration: 3, layers: [L({ wave: 'sawtooth', f: [120, 70], a: 1.2, d: 0.3, s: 0.9, r: 1.3, gain: 0.3, filter: { type: 'lowpass', f: [900, 300] } }), L({ wave: 'pink', a: 1.2, d: 0.3, s: 0.9, r: 1.3, gain: 0.4, filter: { type: 'bandpass', f: [1500, 600], q: 0.8 } })] }),
  def('vehicle_horn', 'Car horn', 'Vehicles', ['honk', 'horn'], { duration: 0.8, layers: [tone(420, 420, 0.7, 'sawtooth', 0.25), tone(520, 520, 0.7, 'sawtooth', 0.2)].map((l) => ({ ...l, filter: { type: 'lowpass' as const, f: [2000, 2000] as [number, number] } })) }),
  def('vehicle_engine_rev', 'Engine rev', 'Vehicles', ['motor', 'rev'], { duration: 1.6, layers: [L({ wave: 'sawtooth', f: [60, 220], a: 0.5, d: 0.3, s: 0.8, r: 0.6, gain: 0.3, filter: { type: 'lowpass', f: [500, 2500] } }), L({ wave: 'square', f: [120, 440], a: 0.5, d: 0.3, s: 0.6, r: 0.6, gain: 0.12, filter: { type: 'lowpass', f: [800, 3000] } })] }),
  def('vehicle_helicopter', 'Helicopter', 'Vehicles', ['chopper', 'rotor'], { duration: 3, layers: Array.from({ length: 36 }, (_, i) => L({ wave: 'pink', a: 0.005, d: 0.03, s: 0.3, r: 0.03, gain: 0.5, at: i * 0.083, dur: 0.07, filter: { type: 'lowpass', f: [600, 300] } })) }),
  def('vehicle_siren', 'Siren', 'Vehicles', ['police', 'ambulance'], { duration: 2.4, layers: [L({ wave: 'sawtooth', f: [600, 900], a: 0.05, d: 0.1, s: 0.9, r: 0.1, gain: 0.2, dur: 0.6, filter: { type: 'lowpass', f: [3000, 3000] } }), L({ wave: 'sawtooth', f: [900, 600], a: 0.05, d: 0.1, s: 0.9, r: 0.1, gain: 0.2, at: 0.6, dur: 0.6 }), L({ wave: 'sawtooth', f: [600, 900], a: 0.05, d: 0.1, s: 0.9, r: 0.1, gain: 0.2, at: 1.2, dur: 0.6 }), L({ wave: 'sawtooth', f: [900, 600], a: 0.05, d: 0.1, s: 0.9, r: 0.1, gain: 0.2, at: 1.8, dur: 0.6 })] }),
  // Weapons
  def('weapon_gunshot', 'Gunshot', 'Weapons', ['gun', 'shot'], { duration: 1, layers: [L({ wave: 'noise', a: 0.001, d: 0.05, s: 0.2, r: 0.3, gain: 0.9, filter: { type: 'lowpass', f: [6000, 400] } }), thump(180, 40, 0.4, 0.9)], reverb: 0.6 }),
  def('weapon_sword', 'Sword swing', 'Weapons', ['blade', 'slash'], { duration: 0.5, layers: [noiseSweep(0.4, 1500, 6000, 4, 0.5), tone(3000, 2500, 0.3, 'triangle', 0.08, 0.1)] }),
  def('weapon_reload', 'Reload', 'Weapons', ['click', 'mag'], { duration: 0.7, layers: [click(900, 0.03, 0.5), { ...click(1300, 0.025, 0.5), at: 0.25 }, { ...click(700, 0.04, 0.6), at: 0.5 }, L({ wave: 'noise', a: 0.001, d: 0.03, s: 0, r: 0.03, gain: 0.3, at: 0.5, dur: 0.06, filter: { type: 'highpass', f: [2500, 2500] } })] }),
  def('weapon_explosion', 'Explosion', 'Weapons', ['boom', 'blast'], { duration: 2.5, layers: [L({ wave: 'noise', a: 0.002, d: 0.3, s: 0.4, r: 1.8, gain: 0.9, filter: { type: 'lowpass', f: [3000, 150] } }), thump(120, 25, 2, 1), L({ wave: 'pink', a: 0.1, d: 0.5, s: 0.5, r: 1.5, gain: 0.6, filter: { type: 'lowpass', f: [500, 100] } })], reverb: 0.7 }),
  def('weapon_arrow', 'Arrow', 'Weapons', ['bow', 'shoot'], { duration: 0.5, layers: [click(400, 0.02, 0.5), noiseSweep(0.35, 2500, 7000, 5, 0.4), { ...thump(300, 90, 0.1, 0.4), at: 0.35 }] }),
  // Sports
  def('sport_whistle', 'Referee whistle', 'Sports', ['whistle', 'referee'], { duration: 0.7, layers: [L({ wave: 'sine', f: [2600, 2600], a: 0.01, d: 0.1, s: 0.9, r: 0.05, gain: 0.4, vib: [60, 35] }), L({ wave: 'sine', f: [2850, 2850], a: 0.01, d: 0.1, s: 0.7, r: 0.05, gain: 0.25, vib: [60, 35] })] }),
  def('sport_crowd', 'Stadium crowd', 'Sports', ['cheer', 'crowd'], { duration: 4, layers: [L({ wave: 'pink', a: 1, d: 1, s: 0.8, r: 1.5, gain: 0.5, filter: { type: 'bandpass', f: [600, 1200], q: 0.7 } }), L({ wave: 'noise', a: 1.5, d: 1, s: 0.6, r: 1.5, gain: 0.25, filter: { type: 'bandpass', f: [2000, 2500], q: 0.8 } })], reverb: 0.5 }),
  def('sport_buzzer', 'Buzzer', 'Sports', ['end', 'basketball'], { duration: 1, layers: [tone(180, 180, 0.9, 'square', 0.3), tone(182, 182, 0.9, 'sawtooth', 0.2)].map((l) => ({ ...l, filter: { type: 'lowpass' as const, f: [1500, 1500] as [number, number] } })) }),
  def('sport_ball_bounce', 'Ball bounce', 'Sports', ['basketball', 'bounce'], { duration: 1.6, layers: [thump(220, 90, 0.18, 0.7), { ...thump(220, 90, 0.16, 0.6), at: 0.5 }, { ...thump(220, 90, 0.14, 0.5), at: 0.9 }, { ...thump(220, 90, 0.12, 0.4), at: 1.2 }, { ...thump(220, 90, 0.1, 0.3), at: 1.4 }] }),
  def('sport_golf', 'Golf swing', 'Sports', ['swing', 'hit'], { duration: 0.6, layers: [noiseSweep(0.3, 800, 4000, 3, 0.4), { ...click(1500, 0.03, 0.8), at: 0.28 }, { ...thump(500, 200, 0.08, 0.5), at: 0.28 }] }),
];


/** Real recorded samples (Kenney, CC0) */
export const SFX_SAMPLES: SfxDef[] = SFX_SAMPLE_ROWS.map(([path, name, category, tags, duration]) => ({
  id: 'k:' + path.replace(/\.ogg$/, ''),
  name,
  category,
  tags,
  source: 'sample' as const,
  duration,
  url: 'sfx/' + path,
  credit: 'Kenney.nl (CC0)',
}));

/** Full library: real samples first, then synthesized sounds. */
export const SFX: SfxDef[] = [...SFX_SAMPLES, ...SFX_SYNTH];
const byId = new Map(SFX.map((s) => [s.id, s]));
export const getSfx = (id: string) => byId.get(id);
export const sfxUrl = (s: SfxDef) => (s.url ? `${import.meta.env.BASE_URL}${s.url}` : null);

