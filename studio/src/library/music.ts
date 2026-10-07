/**
 * Music library — generative, pattern-based tracks rendered in-app with the Web Audio API.
 * Because every track is synthesized from these definitions, they are royalty-free and loopable.
 */
import { playLayer, impulseResponse, midiToHz, SCALES, chord, type Layer, type Wave } from './synth';

export type Genre = 'Lo-fi' | 'Hip-hop' | 'Trap' | 'EDM' | 'Pop' | 'Cinematic' | 'Ambient' | 'Synthwave' | 'Funk' | 'Rock' | 'Acoustic' | 'Jazz' | 'Latin' | 'Corporate' | 'Chill';
export type Mood = 'Happy' | 'Energetic' | 'Chill' | 'Dark' | 'Epic' | 'Sad' | 'Romantic' | 'Funny' | 'Inspiring' | 'Tense';

export interface Timbre {
  wave: Wave;
  filter?: Layer['filter'];
  a?: number;
  d?: number;
  s?: number;
  r?: number;
  gain?: number;
  detune?: number;
  vib?: [number, number];
}
export interface MusicTrack {
  id: string;
  name: string;
  genre: Genre;
  mood: Mood[];
  bpm: number;
  key: number; // midi root (e.g. 57 = A3)
  scale: keyof typeof SCALES;
  /** chord degrees per bar (0-based scale degrees) */
  progression: number[];
  /** 16-step patterns: 'x' hit, '.' rest, 'X' accent */
  drums: { kick: string; snare: string; hat: string; clap?: string; open?: string };
  bass: string; // 16 steps: digits = chord note index (0 root, 1 third, 2 fifth), '.' rest, '-' hold
  bassOct: number;
  pad?: Timbre;
  bassT: Timbre;
  lead?: Timbre;
  leadDensity: number; // 0..1 probability per 8th
  arp?: Timbre;
  swing?: number; // 0..0.3
  drumsGain?: number;
  reverb: number;
  tags: string[];
}

const T = (t: Timbre) => t;
const K = { C: 60, D: 62, E: 64, F: 65, G: 67, A: 57, B: 59, Eb: 63, Bb: 58, Ab: 56, Db: 61, F2: 53 };

export const MUSIC: MusicTrack[] = [
  { id: 'lofi_study', name: 'Late Night Study', genre: 'Lo-fi', mood: ['Chill', 'Sad'], bpm: 78, key: K.F2 + 12, scale: 'dorian', progression: [0, 3, 4, 0], drums: { kick: 'x..x..x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, bass: '0---..2-..0-.3--', bassOct: -2, pad: T({ wave: 'triangle', a: 0.4, d: 0.5, s: 0.6, r: 0.8, gain: 0.12, filter: { type: 'lowpass', f: [1200, 1200] } }), bassT: T({ wave: 'sine', a: 0.01, d: 0.2, s: 0.5, r: 0.1, gain: 0.35 }), lead: T({ wave: 'triangle', a: 0.02, d: 0.3, s: 0.3, r: 0.3, gain: 0.14, filter: { type: 'lowpass', f: [2500, 2500] }, vib: [4, 5] }), leadDensity: 0.35, swing: 0.18, reverb: 0.45, tags: ['study', 'relax', 'vlog'] },
  { id: 'lofi_rain', name: 'Rainy Window', genre: 'Lo-fi', mood: ['Chill', 'Romantic'], bpm: 72, key: K.Eb, scale: 'major', progression: [1, 4, 0, 5], drums: { kick: 'x.....x.x.......', snare: '....x.......x..x', hat: 'x.xxx.x.x.xxx.x.' }, bass: '0-----..0-..2---', bassOct: -2, pad: T({ wave: 'sine', a: 0.6, d: 0.5, s: 0.7, r: 1, gain: 0.14 }), bassT: T({ wave: 'triangle', a: 0.01, d: 0.3, s: 0.4, r: 0.1, gain: 0.3, filter: { type: 'lowpass', f: [500, 500] } }), lead: T({ wave: 'sine', a: 0.03, d: 0.4, s: 0.2, r: 0.4, gain: 0.13, vib: [3, 4] }), leadDensity: 0.3, swing: 0.2, reverb: 0.5, tags: ['calm', 'cozy'] },
  { id: 'hiphop_boom', name: 'Boom Bap Streets', genre: 'Hip-hop', mood: ['Energetic', 'Dark'], bpm: 92, key: K.A, scale: 'minor', progression: [0, 0, 5, 3], drums: { kick: 'x..x....x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx' }, bass: '0-..0-..3-..5-..', bassOct: -2, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.15, s: 0.4, r: 0.05, gain: 0.3, filter: { type: 'lowpass', f: [400, 400] } }), pad: T({ wave: 'square', a: 0.05, d: 0.3, s: 0.3, r: 0.3, gain: 0.06, filter: { type: 'lowpass', f: [900, 900] } }), lead: T({ wave: 'square', a: 0.01, d: 0.2, s: 0.2, r: 0.2, gain: 0.08, filter: { type: 'lowpass', f: [1800, 1800] } }), leadDensity: 0.25, swing: 0.12, drumsGain: 1.1, reverb: 0.3, tags: ['beat', 'urban'] },
  { id: 'trap_808', name: '808 Nights', genre: 'Trap', mood: ['Dark', 'Energetic'], bpm: 140, key: K.F2 + 12, scale: 'minor', progression: [0, 0, 3, 4], drums: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', open: '..............x.' }, bass: '0-------..0-3---', bassOct: -2, bassT: T({ wave: 'sine', a: 0.005, d: 0.4, s: 0.6, r: 0.1, gain: 0.5 }), pad: T({ wave: 'sawtooth', a: 0.3, d: 0.4, s: 0.5, r: 0.6, gain: 0.05, filter: { type: 'lowpass', f: [700, 700] } }), lead: T({ wave: 'triangle', a: 0.01, d: 0.3, s: 0.1, r: 0.3, gain: 0.1 }), leadDensity: 0.3, drumsGain: 1.1, reverb: 0.4, tags: ['808', 'hard'] },
  { id: 'trap_drill', name: 'Drill Shadows', genre: 'Trap', mood: ['Dark', 'Tense'], bpm: 142, key: K.C, scale: 'minor', progression: [0, 5, 3, 4], drums: { kick: 'x.....x...x..x..', snare: '...x......x.....', hat: 'x.xx.x.xx.x.x.xx' }, bass: '0--.0-..3---.4--', bassOct: -2, bassT: T({ wave: 'sine', a: 0.005, d: 0.3, s: 0.7, r: 0.1, gain: 0.5 }), pad: T({ wave: 'triangle', a: 0.2, d: 0.4, s: 0.6, r: 0.5, gain: 0.08 }), lead: T({ wave: 'sine', a: 0.02, d: 0.3, s: 0.1, r: 0.3, gain: 0.1 }), leadDensity: 0.25, drumsGain: 1.1, reverb: 0.5, tags: ['drill', 'uk'] },
  { id: 'edm_drop', name: 'Festival Drop', genre: 'EDM', mood: ['Energetic', 'Happy'], bpm: 128, key: K.A, scale: 'minor', progression: [0, 5, 3, 4], drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '....x.......x...' }, bass: '0.0.0.0.0.0.0.0.', bassOct: -1, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.1, s: 0.3, r: 0.05, gain: 0.3, filter: { type: 'lowpass', f: [900, 900] } }), pad: T({ wave: 'sawtooth', a: 0.05, d: 0.2, s: 0.6, r: 0.2, gain: 0.08, detune: 10, filter: { type: 'lowpass', f: [3000, 3000] } }), lead: T({ wave: 'sawtooth', a: 0.01, d: 0.15, s: 0.4, r: 0.1, gain: 0.12, detune: 8, filter: { type: 'lowpass', f: [4000, 4000] } }), leadDensity: 0.6, arp: T({ wave: 'square', a: 0.005, d: 0.08, s: 0.1, r: 0.05, gain: 0.06, filter: { type: 'lowpass', f: [2500, 2500] } }), drumsGain: 1.2, reverb: 0.35, tags: ['club', 'dance', 'party'] },
  { id: 'edm_future', name: 'Future Bounce', genre: 'EDM', mood: ['Happy', 'Energetic'], bpm: 126, key: K.G, scale: 'major', progression: [3, 4, 5, 0], drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', open: '..x...x...x...x.' }, bass: '0-.0-.0.0-.0-.0.', bassOct: -1, bassT: T({ wave: 'square', a: 0.005, d: 0.1, s: 0.3, r: 0.05, gain: 0.22, filter: { type: 'lowpass', f: [700, 700] } }), pad: T({ wave: 'sawtooth', a: 0.02, d: 0.15, s: 0.5, r: 0.15, gain: 0.08, detune: 12, filter: { type: 'lowpass', f: [2500, 2500] } }), lead: T({ wave: 'triangle', a: 0.01, d: 0.1, s: 0.4, r: 0.1, gain: 0.12 }), leadDensity: 0.5, drumsGain: 1.15, reverb: 0.3, tags: ['bounce', 'bright'] },
  { id: 'pop_summer', name: 'Summer Pop', genre: 'Pop', mood: ['Happy', 'Inspiring'], bpm: 112, key: K.D, scale: 'major', progression: [0, 4, 5, 3], drums: { kick: 'x.....x.x.....x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' }, bass: '0-..0-..0-..2-..', bassOct: -2, bassT: T({ wave: 'triangle', a: 0.005, d: 0.2, s: 0.5, r: 0.05, gain: 0.35 }), pad: T({ wave: 'triangle', a: 0.1, d: 0.3, s: 0.6, r: 0.4, gain: 0.1 }), lead: T({ wave: 'sine', a: 0.01, d: 0.2, s: 0.4, r: 0.2, gain: 0.14, vib: [3, 5] }), leadDensity: 0.5, arp: T({ wave: 'triangle', a: 0.005, d: 0.1, s: 0.1, r: 0.05, gain: 0.06 }), reverb: 0.35, tags: ['upbeat', 'travel', 'vlog'] },
  { id: 'pop_dance', name: 'Neon Dance Pop', genre: 'Pop', mood: ['Energetic', 'Happy'], bpm: 120, key: K.Bb, scale: 'major', progression: [5, 3, 0, 4], drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', clap: '....x.......x...' }, bass: '0.0-0.0-2.2-2.2-', bassOct: -2, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.1, s: 0.4, r: 0.05, gain: 0.25, filter: { type: 'lowpass', f: [600, 600] } }), pad: T({ wave: 'sawtooth', a: 0.05, d: 0.2, s: 0.5, r: 0.3, gain: 0.06, detune: 8, filter: { type: 'lowpass', f: [2000, 2000] } }), lead: T({ wave: 'square', a: 0.01, d: 0.15, s: 0.3, r: 0.15, gain: 0.08, filter: { type: 'lowpass', f: [3000, 3000] } }), leadDensity: 0.5, drumsGain: 1.1, reverb: 0.3, tags: ['dance', 'fun'] },
  { id: 'cine_epic', name: 'Rise of Heroes', genre: 'Cinematic', mood: ['Epic', 'Inspiring'], bpm: 100, key: K.D, scale: 'minor', progression: [0, 5, 2, 6], drums: { kick: 'x.......x...x...', snare: '........x.......', hat: '................' }, bass: '0-------0---2---', bassOct: -2, bassT: T({ wave: 'sawtooth', a: 0.05, d: 0.3, s: 0.8, r: 0.3, gain: 0.25, filter: { type: 'lowpass', f: [500, 500] } }), pad: T({ wave: 'sawtooth', a: 0.8, d: 0.5, s: 0.8, r: 1.2, gain: 0.1, detune: 6, filter: { type: 'lowpass', f: [1800, 1800] } }), lead: T({ wave: 'triangle', a: 0.1, d: 0.4, s: 0.6, r: 0.5, gain: 0.12, vib: [4, 5] }), leadDensity: 0.3, arp: T({ wave: 'triangle', a: 0.005, d: 0.15, s: 0.1, r: 0.1, gain: 0.07 }), drumsGain: 1.4, reverb: 0.85, tags: ['trailer', 'orchestral', 'epic'] },
  { id: 'cine_tension', name: 'Countdown', genre: 'Cinematic', mood: ['Tense', 'Dark'], bpm: 110, key: K.E, scale: 'minor', progression: [0, 0, 1, 0], drums: { kick: 'x...x...x...x...', snare: '......x.......x.', hat: 'x.x.x.x.x.x.x.x.' }, bass: '0.0.0.0.0.0.1.1.', bassOct: -2, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.1, s: 0.3, r: 0.05, gain: 0.25, filter: { type: 'lowpass', f: [400, 400] } }), pad: T({ wave: 'sawtooth', a: 0.5, d: 0.5, s: 0.8, r: 0.8, gain: 0.07, filter: { type: 'lowpass', f: [900, 900] } }), lead: T({ wave: 'sine', a: 0.05, d: 0.3, s: 0.3, r: 0.3, gain: 0.08 }), leadDensity: 0.15, arp: T({ wave: 'square', a: 0.005, d: 0.06, s: 0.1, r: 0.05, gain: 0.05, filter: { type: 'lowpass', f: [1500, 1500] } }), drumsGain: 1.2, reverb: 0.6, tags: ['thriller', 'suspense'] },
  { id: 'cine_emotional', name: 'Last Goodbye', genre: 'Cinematic', mood: ['Sad', 'Romantic'], bpm: 70, key: K.Ab, scale: 'major', progression: [5, 3, 0, 4], drums: { kick: '................', snare: '................', hat: '................' }, bass: '0-------0-------', bassOct: -2, bassT: T({ wave: 'sine', a: 0.05, d: 0.4, s: 0.7, r: 0.5, gain: 0.3 }), pad: T({ wave: 'triangle', a: 0.8, d: 0.6, s: 0.8, r: 1.5, gain: 0.12 }), lead: T({ wave: 'sine', a: 0.05, d: 0.5, s: 0.5, r: 0.6, gain: 0.14, vib: [3, 4.5] }), leadDensity: 0.35, arp: T({ wave: 'sine', a: 0.01, d: 0.4, s: 0.1, r: 0.3, gain: 0.08 }), reverb: 0.9, tags: ['piano', 'emotional', 'wedding'] },
  { id: 'ambient_space', name: 'Deep Space', genre: 'Ambient', mood: ['Chill', 'Dark'], bpm: 60, key: K.C, scale: 'minor', progression: [0, 2, 5, 3], drums: { kick: '................', snare: '................', hat: '................' }, bass: '0---------------', bassOct: -2, bassT: T({ wave: 'sine', a: 1, d: 1, s: 0.8, r: 1.5, gain: 0.25 }), pad: T({ wave: 'sawtooth', a: 2, d: 1, s: 0.8, r: 2.5, gain: 0.07, detune: 5, filter: { type: 'lowpass', f: [900, 900] }, vib: [2, 0.4] }), lead: T({ wave: 'sine', a: 0.5, d: 1, s: 0.5, r: 1.5, gain: 0.08 }), leadDensity: 0.12, reverb: 1, tags: ['meditation', 'drone', 'calm'] },
  { id: 'ambient_morning', name: 'Morning Light', genre: 'Ambient', mood: ['Chill', 'Inspiring'], bpm: 66, key: K.G, scale: 'major', progression: [0, 3, 4, 0], drums: { kick: '................', snare: '................', hat: '................' }, bass: '0-------2-------', bassOct: -2, bassT: T({ wave: 'triangle', a: 0.5, d: 1, s: 0.7, r: 1, gain: 0.2 }), pad: T({ wave: 'triangle', a: 1.5, d: 1, s: 0.8, r: 2, gain: 0.1 }), lead: T({ wave: 'sine', a: 0.2, d: 0.6, s: 0.4, r: 0.8, gain: 0.1 }), leadDensity: 0.25, arp: T({ wave: 'sine', a: 0.01, d: 0.5, s: 0.05, r: 0.4, gain: 0.07 }), reverb: 0.9, tags: ['nature', 'yoga', 'soft'] },
  { id: 'synth_retro', name: 'Retrowave Drive', genre: 'Synthwave', mood: ['Energetic', 'Chill'], bpm: 108, key: K.A, scale: 'minor', progression: [0, 5, 3, 4], drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' }, bass: '0.0.0.0.0.0.0.0.', bassOct: -1, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.08, s: 0.3, r: 0.05, gain: 0.22, filter: { type: 'lowpass', f: [800, 800] } }), pad: T({ wave: 'sawtooth', a: 0.3, d: 0.3, s: 0.7, r: 0.6, gain: 0.07, detune: 10, filter: { type: 'lowpass', f: [2200, 2200] } }), lead: T({ wave: 'square', a: 0.01, d: 0.2, s: 0.5, r: 0.2, gain: 0.08, filter: { type: 'lowpass', f: [2500, 2500] }, vib: [4, 6] }), leadDensity: 0.4, arp: T({ wave: 'sawtooth', a: 0.005, d: 0.1, s: 0.1, r: 0.05, gain: 0.05, filter: { type: 'lowpass', f: [3000, 3000] } }), drumsGain: 1.1, reverb: 0.5, tags: ['80s', 'retro', 'neon'] },
  { id: 'synth_outrun', name: 'Outrun Sunset', genre: 'Synthwave', mood: ['Romantic', 'Chill'], bpm: 96, key: K.F2 + 12, scale: 'major', progression: [0, 5, 3, 4], drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, bass: '0-.0-.0.0-.0-.0.', bassOct: -1, bassT: T({ wave: 'square', a: 0.005, d: 0.1, s: 0.4, r: 0.05, gain: 0.2, filter: { type: 'lowpass', f: [600, 600] } }), pad: T({ wave: 'sawtooth', a: 0.5, d: 0.4, s: 0.7, r: 0.8, gain: 0.07, detune: 12, filter: { type: 'lowpass', f: [1600, 1600] } }), lead: T({ wave: 'triangle', a: 0.02, d: 0.3, s: 0.5, r: 0.3, gain: 0.1, vib: [5, 5] }), leadDensity: 0.35, reverb: 0.6, tags: ['sunset', 'drive'] },
  { id: 'funk_groove', name: 'Funky Groove', genre: 'Funk', mood: ['Happy', 'Funny'], bpm: 104, key: K.E, scale: 'dorian', progression: [0, 0, 3, 4], drums: { kick: 'x..x..x...x..x..', snare: '....x..x....x...', hat: 'x.xxx.xxx.xxx.xx', open: '......x.......x.' }, bass: '0.-.0.3.-.0.2.4.', bassOct: -2, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.12, s: 0.3, r: 0.05, gain: 0.3, filter: { type: 'lowpass', f: [700, 700], q: 3 } }), pad: T({ wave: 'square', a: 0.01, d: 0.1, s: 0.2, r: 0.1, gain: 0.05, filter: { type: 'bandpass', f: [1500, 1500], q: 1.5 } }), lead: T({ wave: 'square', a: 0.01, d: 0.1, s: 0.3, r: 0.1, gain: 0.07, filter: { type: 'lowpass', f: [2500, 2500] } }), leadDensity: 0.45, swing: 0.15, drumsGain: 1.1, reverb: 0.25, tags: ['groove', 'comedy', 'cooking'] },
  { id: 'rock_drive', name: 'Highway Rock', genre: 'Rock', mood: ['Energetic', 'Epic'], bpm: 132, key: K.E, scale: 'minor', progression: [0, 5, 3, 4], drums: { kick: 'x...x.x.x...x.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', open: '..............x.' }, bass: '0.0.0.0.0.0.0.0.', bassOct: -2, bassT: T({ wave: 'sawtooth', a: 0.005, d: 0.1, s: 0.5, r: 0.05, gain: 0.3, filter: { type: 'lowpass', f: [1200, 1200] } }), pad: T({ wave: 'sawtooth', a: 0.01, d: 0.2, s: 0.6, r: 0.1, gain: 0.07, detune: 15, filter: { type: 'lowpass', f: [2500, 2500], q: 1.5 } }), lead: T({ wave: 'sawtooth', a: 0.01, d: 0.2, s: 0.5, r: 0.2, gain: 0.09, filter: { type: 'lowpass', f: [3500, 3500] }, vib: [6, 6] }), leadDensity: 0.45, drumsGain: 1.25, reverb: 0.35, tags: ['guitar', 'sport', 'action'] },
  { id: 'acoustic_folk', name: 'Country Road', genre: 'Acoustic', mood: ['Happy', 'Inspiring'], bpm: 118, key: K.G, scale: 'major', progression: [0, 3, 4, 0], drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, bass: '0-..2-..0-..2-..', bassOct: -2, bassT: T({ wave: 'triangle', a: 0.005, d: 0.3, s: 0.3, r: 0.1, gain: 0.3 }), pad: T({ wave: 'triangle', a: 0.005, d: 0.4, s: 0.1, r: 0.3, gain: 0.1 }), lead: T({ wave: 'triangle', a: 0.005, d: 0.3, s: 0.2, r: 0.2, gain: 0.12 }), leadDensity: 0.5, arp: T({ wave: 'triangle', a: 0.003, d: 0.25, s: 0.05, r: 0.2, gain: 0.09 }), drumsGain: 0.8, reverb: 0.3, tags: ['guitar', 'folk', 'travel'] },
  { id: 'acoustic_ukulele', name: 'Sunny Ukulele', genre: 'Acoustic', mood: ['Happy', 'Funny'], bpm: 124, key: K.C, scale: 'major', progression: [0, 4, 5, 3], drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' }, bass: '0-..0-..2-..2-..', bassOct: -2, bassT: T({ wave: 'sine', a: 0.005, d: 0.3, s: 0.3, r: 0.1, gain: 0.3 }), pad: T({ wave: 'triangle', a: 0.003, d: 0.2, s: 0.05, r: 0.15, gain: 0.1 }), lead: T({ wave: 'triangle', a: 0.003, d: 0.2, s: 0.1, r: 0.15, gain: 0.12 }), leadDensity: 0.55, arp: T({ wave: 'triangle', a: 0.003, d: 0.15, s: 0.05, r: 0.1, gain: 0.1 }), drumsGain: 0.7, reverb: 0.25, tags: ['kids', 'fun', 'ad'] },
  { id: 'jazz_lounge', name: 'Midnight Lounge', genre: 'Jazz', mood: ['Chill', 'Romantic'], bpm: 88, key: K.F2 + 12, scale: 'dorian', progression: [1, 4, 0, 0], drums: { kick: 'x.......x.......', snare: '................', hat: 'x..x.xx..x.x..x.' }, bass: '0.2.4.2.0.3.2.1.', bassOct: -2, bassT: T({ wave: 'sine', a: 0.01, d: 0.3, s: 0.3, r: 0.1, gain: 0.3 }), pad: T({ wave: 'triangle', a: 0.02, d: 0.5, s: 0.3, r: 0.4, gain: 0.08 }), lead: T({ wave: 'sine', a: 0.02, d: 0.3, s: 0.3, r: 0.3, gain: 0.11, vib: [4, 5.5] }), leadDensity: 0.4, swing: 0.25, drumsGain: 0.7, reverb: 0.45, tags: ['bar', 'smooth', 'restaurant'] },
  { id: 'latin_reggaeton', name: 'Fiesta Noche', genre: 'Latin', mood: ['Happy', 'Energetic'], bpm: 96, key: K.A, scale: 'minor', progression: [0, 5, 3, 4], drums: { kick: 'x...x...x...x...', snare: '...x..x....x..x.', hat: 'x.x.x.x.x.x.x.x.', clap: '...x..x....x..x.' }, bass: '0--.0.0--.3-.4--', bassOct: -2, bassT: T({ wave: 'sine', a: 0.005, d: 0.2, s: 0.5, r: 0.05, gain: 0.4 }), pad: T({ wave: 'sawtooth', a: 0.02, d: 0.2, s: 0.4, r: 0.2, gain: 0.06, filter: { type: 'lowpass', f: [1800, 1800] } }), lead: T({ wave: 'square', a: 0.01, d: 0.15, s: 0.3, r: 0.1, gain: 0.08, filter: { type: 'lowpass', f: [2500, 2500] } }), leadDensity: 0.45, drumsGain: 1.1, reverb: 0.3, tags: ['dembow', 'party', 'dance'] },
  { id: 'corporate_bright', name: 'Bright Future', genre: 'Corporate', mood: ['Inspiring', 'Happy'], bpm: 116, key: K.C, scale: 'major', progression: [0, 4, 5, 3], drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' }, bass: '0-------2-------', bassOct: -2, bassT: T({ wave: 'triangle', a: 0.01, d: 0.3, s: 0.6, r: 0.1, gain: 0.25 }), pad: T({ wave: 'triangle', a: 0.3, d: 0.4, s: 0.7, r: 0.6, gain: 0.1 }), lead: T({ wave: 'sine', a: 0.01, d: 0.3, s: 0.3, r: 0.3, gain: 0.1 }), leadDensity: 0.3, arp: T({ wave: 'triangle', a: 0.003, d: 0.2, s: 0.05, r: 0.15, gain: 0.09 }), drumsGain: 0.8, reverb: 0.4, tags: ['business', 'presentation', 'tech'] },
  { id: 'corporate_tech', name: 'Startup Pulse', genre: 'Corporate', mood: ['Inspiring', 'Energetic'], bpm: 122, key: K.D, scale: 'major', progression: [5, 3, 0, 4], drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' }, bass: '0.0.0.0.0.0.0.0.', bassOct: -1, bassT: T({ wave: 'square', a: 0.005, d: 0.1, s: 0.3, r: 0.05, gain: 0.18, filter: { type: 'lowpass', f: [600, 600] } }), pad: T({ wave: 'sawtooth', a: 0.2, d: 0.3, s: 0.6, r: 0.4, gain: 0.05, detune: 8, filter: { type: 'lowpass', f: [2000, 2000] } }), lead: T({ wave: 'triangle', a: 0.01, d: 0.2, s: 0.3, r: 0.2, gain: 0.09 }), leadDensity: 0.35, arp: T({ wave: 'square', a: 0.003, d: 0.08, s: 0.05, r: 0.05, gain: 0.05, filter: { type: 'lowpass', f: [2500, 2500] } }), drumsGain: 0.9, reverb: 0.35, tags: ['product', 'explainer'] },
  { id: 'chill_tropical', name: 'Tropical Breeze', genre: 'Chill', mood: ['Happy', 'Chill'], bpm: 102, key: K.F2 + 12, scale: 'major', progression: [0, 3, 4, 5], drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '....x.......x...' }, bass: '0-..0-..2-..4-..', bassOct: -2, bassT: T({ wave: 'sine', a: 0.005, d: 0.2, s: 0.5, r: 0.1, gain: 0.35 }), pad: T({ wave: 'triangle', a: 0.2, d: 0.3, s: 0.6, r: 0.5, gain: 0.08 }), lead: T({ wave: 'sine', a: 0.005, d: 0.2, s: 0.2, r: 0.2, gain: 0.13 }), leadDensity: 0.45, arp: T({ wave: 'triangle', a: 0.003, d: 0.15, s: 0.05, r: 0.1, gain: 0.08 }), reverb: 0.4, tags: ['beach', 'summer', 'travel'] },
  { id: 'chill_hop', name: 'Chillhop Café', genre: 'Chill', mood: ['Chill', 'Happy'], bpm: 86, key: K.Bb, scale: 'major', progression: [1, 4, 0, 5], drums: { kick: 'x..x....x.x.....', snare: '....x.......x...', hat: 'x.x.x.xxx.x.x.x.' }, bass: '0-..2-..0-..4-..', bassOct: -2, bassT: T({ wave: 'triangle', a: 0.01, d: 0.3, s: 0.4, r: 0.1, gain: 0.3, filter: { type: 'lowpass', f: [600, 600] } }), pad: T({ wave: 'triangle', a: 0.05, d: 0.4, s: 0.5, r: 0.5, gain: 0.1, filter: { type: 'lowpass', f: [1500, 1500] } }), lead: T({ wave: 'sine', a: 0.02, d: 0.3, s: 0.3, r: 0.3, gain: 0.12, vib: [3, 5] }), leadDensity: 0.4, swing: 0.16, reverb: 0.45, tags: ['café', 'relax', 'work'] },
];

export const GENRES: Genre[] = ['Lo-fi', 'Hip-hop', 'Trap', 'EDM', 'Pop', 'Cinematic', 'Ambient', 'Synthwave', 'Funk', 'Rock', 'Acoustic', 'Jazz', 'Latin', 'Corporate', 'Chill'];
export const MOODS: Mood[] = ['Happy', 'Energetic', 'Chill', 'Dark', 'Epic', 'Sad', 'Romantic', 'Funny', 'Inspiring', 'Tense'];
export const getTrack = (id: string) => MUSIC.find((m) => m.id === id);

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}
const hash = (s: string) => Array.from(s).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function note(ctx: BaseAudioContext, dest: AudioNode, t: Timbre, midi: number, at: number, dur: number, gainMul = 1) {
  playLayer(ctx, dest, { wave: t.wave, f: [midiToHz(midi), midiToHz(midi)], a: t.a ?? 0.01, d: t.d ?? 0.1, s: t.s ?? 0.5, r: t.r ?? 0.1, gain: (t.gain ?? 0.2) * gainMul, filter: t.filter, detune: t.detune, vib: t.vib, at, dur }, 0, at + dur);
}

function drum(ctx: BaseAudioContext, dest: AudioNode, kind: 'kick' | 'snare' | 'hat' | 'clap' | 'open', at: number, accent: number, gain: number) {
  const g = gain * accent;
  if (kind === 'kick') playLayer(ctx, dest, { wave: 'sine', f: [150, 40], a: 0.002, d: 0.25, s: 0, r: 0.05, gain: 0.9 * g, dur: 0.3 }, at, at + 0.3);
  if (kind === 'snare') {
    playLayer(ctx, dest, { wave: 'noise', a: 0.001, d: 0.12, s: 0, r: 0.05, gain: 0.45 * g, dur: 0.18, filter: { type: 'highpass', f: [1500, 1500] } }, at, at + 0.2);
    playLayer(ctx, dest, { wave: 'triangle', f: [220, 160], a: 0.001, d: 0.1, s: 0, r: 0.03, gain: 0.4 * g, dur: 0.12 }, at, at + 0.15);
  }
  if (kind === 'hat') playLayer(ctx, dest, { wave: 'noise', a: 0.001, d: 0.04, s: 0, r: 0.02, gain: 0.22 * g, dur: 0.06, filter: { type: 'highpass', f: [7000, 7000] } }, at, at + 0.07);
  if (kind === 'open') playLayer(ctx, dest, { wave: 'noise', a: 0.001, d: 0.25, s: 0.1, r: 0.1, gain: 0.2 * g, dur: 0.35, filter: { type: 'highpass', f: [6000, 6000] } }, at, at + 0.36);
  if (kind === 'clap') for (let i = 0; i < 3; i++) playLayer(ctx, dest, { wave: 'noise', a: 0.001, d: 0.05, s: 0, r: 0.05, gain: 0.3 * g, dur: 0.1, at: i * 0.012, filter: { type: 'bandpass', f: [1800, 1800], q: 1.2 } }, at, at + 0.15);
}

/** Render `seconds` of a track (bar-aligned, loopable) into an AudioBuffer. */
export async function renderMusic(track: MusicTrack, seconds = 30, sampleRate = 44100, onProgress?: (p: number) => void): Promise<AudioBuffer> {
  const beat = 60 / track.bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const bars = Math.max(1, Math.round(seconds / bar));
  const total = bars * bar;
  const ctx = new OfflineAudioContext(2, Math.ceil((total + 1.5) * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.knee.value = 10;
  master.connect(comp).connect(ctx.destination);
  const conv = ctx.createConvolver();
  conv.buffer = impulseResponse(ctx, 1 + track.reverb * 1.5, 2.5);
  const wet = ctx.createGain();
  wet.gain.value = track.reverb * 0.45;
  conv.connect(wet).connect(master);
  const bus = ctx.createGain();
  bus.connect(master);
  bus.connect(conv);
  const drumBus = ctx.createGain();
  drumBus.gain.value = track.drumsGain ?? 1;
  drumBus.connect(master);
  const scale = SCALES[track.scale];
  const rand = rng(hash(track.id));
  const swing = track.swing ?? 0;
  const dg = 1;
  let lastLead = track.key + 12;
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const degree = track.progression[b % track.progression.length];
    const ch = chord(track.key, scale, degree, 4, 0);
    // pad
    if (track.pad) for (const n of ch.slice(0, 3)) note(ctx, bus, track.pad, n, t0, bar * 0.98);
    // drums
    for (let s = 0; s < 16; s++) {
      const at = t0 + s * step + (s % 2 ? swing * step : 0);
      const hit = (p?: string) => (p ? p[s] : '.');
      for (const k of ['kick', 'snare', 'hat', 'clap', 'open'] as const) {
        const c = hit((track.drums as any)[k]);
        if (c === 'x' || c === 'X') drum(ctx, drumBus, k, at, c === 'X' ? 1.2 : 1, dg);
      }
      // bass
      const bc = track.bass[s];
      if (bc >= '0' && bc <= '9') {
        let len = step;
        for (let j = s + 1; j < 16 && track.bass[j] === '-'; j++) len += step;
        const idx = parseInt(bc);
        const m = ch[idx % ch.length] + track.bassOct * 12 + Math.floor(idx / ch.length) * 12;
        note(ctx, bus, track.bassT, m, at, len * 0.95);
      }
      // arp (16ths)
      if (track.arp && s % 2 === 0) note(ctx, bus, track.arp, ch[(s / 2) % ch.length] + 12, at, step * 1.8);
    }
    // lead melody (8ths), stepwise random walk in scale, phrase repeats every 2 bars
    if (track.lead) {
      const phraseSeed = hash(track.id + Math.floor(b / 2));
      const pr = rng(phraseSeed);
      for (let e = 0; e < 8; e++) {
        if (pr() > track.leadDensity) continue;
        const at = t0 + e * beat * 0.5 + (e % 2 ? swing * step : 0);
        const dir = pr() < 0.5 ? -1 : 1;
        const stepN = Math.floor(pr() * 3);
        // move within scale
        const base = track.key + 12;
        let rel = lastLead - base;
        const octs = Math.floor(rel / 12);
        let degIdx = scale.indexOf(((rel % 12) + 12) % 12);
        if (degIdx < 0) degIdx = 0;
        degIdx += dir * stepN;
        let oct = octs;
        while (degIdx < 0) {
          degIdx += scale.length;
          oct--;
        }
        while (degIdx >= scale.length) {
          degIdx -= scale.length;
          oct++;
        }
        oct = Math.max(0, Math.min(1, oct));
        const m = base + scale[degIdx] + oct * 12;
        // prefer chord tones on strong beats
        const strong = e % 2 === 0;
        const target = strong && pr() < 0.6 ? ch[Math.floor(pr() * 3)] + 12 : m;
        lastLead = target;
        const len = pr() < 0.3 ? beat : beat * 0.5;
        note(ctx, bus, track.lead, target, at, len * 0.9, 1);
      }
    }
    onProgress?.((b + 1) / bars);
    void rand;
  }
  return ctx.startRendering();
}
