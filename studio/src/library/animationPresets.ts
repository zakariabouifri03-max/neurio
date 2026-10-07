/**
 * Keyframe-based motion presets for any visual clip (video, image, sticker, text block, color).
 * Applying a preset writes real keyframes into the clip transform (editable afterwards).
 */
import type { Transform, Vec2, Easing, Keyframe } from '@/core/types';
import { uid } from '@/core/util';

export interface MotionPreset {
  id: string;
  name: string;
  icon: string;
  kind: 'in' | 'out' | 'loop' | 'motion';
  /** builds keyframes for a clip of `duration`. `w,h` = project size. `d` = animation duration */
  build: (t: Transform, duration: number, w: number, h: number, d: number) => Partial<Transform>;
}

const kf = <T,>(time: number, value: T, easing: Easing = 'easeOut'): Keyframe<T> => ({ id: uid('kf'), time, value, easing });
const base = (t: Transform) => ({ pos: t.position.value, sc: t.scale.value, rot: t.rotation.value, op: t.opacity.value });

const inPreset = (id: string, name: string, icon: string, from: (b: ReturnType<typeof base>, w: number, h: number) => { pos?: Vec2; sc?: Vec2; rot?: number; op?: number }, easing: Easing = 'easeOut'): MotionPreset => ({
  id, name, icon, kind: 'in',
  build: (t, _dur, w, h, d) => {
    const b = base(t);
    const f = from(b, w, h);
    const out: Partial<Transform> = {};
    if (f.pos) out.position = { value: b.pos, keyframes: [kf(0, f.pos, easing), kf(d, b.pos)] };
    if (f.sc) out.scale = { value: b.sc, keyframes: [kf(0, f.sc, easing), kf(d, b.sc)] };
    if (f.rot !== undefined) out.rotation = { value: b.rot, keyframes: [kf(0, f.rot, easing), kf(d, b.rot)] };
    if (f.op !== undefined) out.opacity = { value: b.op, keyframes: [kf(0, f.op, easing), kf(d, b.op)] };
    return out;
  },
});
const outPreset = (id: string, name: string, icon: string, to: (b: ReturnType<typeof base>, w: number, h: number) => { pos?: Vec2; sc?: Vec2; rot?: number; op?: number }, easing: Easing = 'easeIn'): MotionPreset => ({
  id, name, icon, kind: 'out',
  build: (t, dur, w, h, d) => {
    const b = base(t);
    const f = to(b, w, h);
    const s = Math.max(0, dur - d);
    const out: Partial<Transform> = {};
    if (f.pos) out.position = { value: b.pos, keyframes: [kf(s, b.pos, easing), kf(dur, f.pos)] };
    if (f.sc) out.scale = { value: b.sc, keyframes: [kf(s, b.sc, easing), kf(dur, f.sc)] };
    if (f.rot !== undefined) out.rotation = { value: b.rot, keyframes: [kf(s, b.rot, easing), kf(dur, f.rot)] };
    if (f.op !== undefined) out.opacity = { value: b.op, keyframes: [kf(s, b.op, easing), kf(dur, f.op)] };
    return out;
  },
});

export const MOTION_PRESETS: MotionPreset[] = [
  inPreset('in_fade', 'Fade In', '◐', () => ({ op: 0 })),
  inPreset('in_zoom', 'Zoom In', '⤢', (b) => ({ sc: { x: b.sc.x * 0.2, y: b.sc.y * 0.2 }, op: 0 })),
  inPreset('in_zoomout', 'Zoom Out In', '⤡', (b) => ({ sc: { x: b.sc.x * 2.2, y: b.sc.y * 2.2 }, op: 0 })),
  inPreset('in_left', 'Slide from Left', '→', (b, w) => ({ pos: { x: b.pos.x - w, y: b.pos.y } })),
  inPreset('in_right', 'Slide from Right', '←', (b, w) => ({ pos: { x: b.pos.x + w, y: b.pos.y } })),
  inPreset('in_top', 'Slide from Top', '↓', (b, _w, h) => ({ pos: { x: b.pos.x, y: b.pos.y - h } })),
  inPreset('in_bottom', 'Slide from Bottom', '↑', (b, _w, h) => ({ pos: { x: b.pos.x, y: b.pos.y + h } })),
  inPreset('in_pop', 'Pop', '✦', (b) => ({ sc: { x: 0, y: 0 } }), 'easeOutBack'),
  inPreset('in_bounce', 'Bounce Drop', '⬇', (b, _w, h) => ({ pos: { x: b.pos.x, y: b.pos.y - h * 0.6 } }), 'easeOutBounce'),
  inPreset('in_spin', 'Spin In', '↻', (b) => ({ rot: b.rot - 360, sc: { x: 0, y: 0 } })),
  inPreset('in_elastic', 'Elastic', '〰', (b) => ({ sc: { x: b.sc.x * 0.3, y: b.sc.y * 0.3 } }), 'easeOutElastic'),
  outPreset('out_fade', 'Fade Out', '◑', () => ({ op: 0 })),
  outPreset('out_zoom', 'Zoom Out', '⤡', (b) => ({ sc: { x: b.sc.x * 0.2, y: b.sc.y * 0.2 }, op: 0 })),
  outPreset('out_zoomin', 'Zoom In Out', '⤢', (b) => ({ sc: { x: b.sc.x * 2.5, y: b.sc.y * 2.5 }, op: 0 })),
  outPreset('out_left', 'Slide to Left', '←', (b, w) => ({ pos: { x: b.pos.x - w, y: b.pos.y } })),
  outPreset('out_right', 'Slide to Right', '→', (b, w) => ({ pos: { x: b.pos.x + w, y: b.pos.y } })),
  outPreset('out_top', 'Slide to Top', '↑', (b, _w, h) => ({ pos: { x: b.pos.x, y: b.pos.y - h } })),
  outPreset('out_bottom', 'Slide to Bottom', '↓', (b, _w, h) => ({ pos: { x: b.pos.x, y: b.pos.y + h } })),
  outPreset('out_shrink', 'Shrink', '•', () => ({ sc: { x: 0, y: 0 } }), 'easeInCubic'),
  outPreset('out_spin', 'Spin Out', '↺', (b) => ({ rot: b.rot + 360, sc: { x: 0, y: 0 } })),
  // motion (whole clip)
  {
    id: 'kb_in', name: 'Ken Burns In', icon: '🎞', kind: 'motion',
    build: (t, dur) => { const b = base(t); return { scale: { value: b.sc, keyframes: [kf(0, b.sc, 'linear'), kf(dur, { x: b.sc.x * 1.2, y: b.sc.y * 1.2 })] } }; },
  },
  {
    id: 'kb_out', name: 'Ken Burns Out', icon: '🎞', kind: 'motion',
    build: (t, dur) => { const b = base(t); return { scale: { value: b.sc, keyframes: [kf(0, { x: b.sc.x * 1.2, y: b.sc.y * 1.2 }, 'linear'), kf(dur, b.sc)] } }; },
  },
  {
    id: 'pan_lr', name: 'Pan Left → Right', icon: '⇄', kind: 'motion',
    build: (t, dur, w) => { const b = base(t); return { scale: { value: { x: b.sc.x * 1.15, y: b.sc.y * 1.15 } }, position: { value: b.pos, keyframes: [kf(0, { x: b.pos.x - w * 0.07, y: b.pos.y }, 'linear'), kf(dur, { x: b.pos.x + w * 0.07, y: b.pos.y })] } }; },
  },
  {
    id: 'pan_tb', name: 'Pan Top → Bottom', icon: '⇅', kind: 'motion',
    build: (t, dur, _w, h) => { const b = base(t); return { scale: { value: { x: b.sc.x * 1.15, y: b.sc.y * 1.15 } }, position: { value: b.pos, keyframes: [kf(0, { x: b.pos.x, y: b.pos.y - h * 0.07 }, 'linear'), kf(dur, { x: b.pos.x, y: b.pos.y + h * 0.07 })] } }; },
  },
  {
    id: 'pulse', name: 'Pulse', icon: '♥', kind: 'loop',
    build: (t, dur) => { const b = base(t); const ks: Keyframe<Vec2>[] = []; for (let s = 0; s <= dur; s += 0.5) ks.push(kf(s, Math.round(s / 0.5) % 2 ? { x: b.sc.x * 1.08, y: b.sc.y * 1.08 } : b.sc, 'easeInOut')); return { scale: { value: b.sc, keyframes: ks } }; },
  },
  {
    id: 'float', name: 'Float', icon: '☁', kind: 'loop',
    build: (t, dur, _w, h) => { const b = base(t); const ks: Keyframe<Vec2>[] = []; for (let s = 0; s <= dur; s += 1) ks.push(kf(s, { x: b.pos.x, y: b.pos.y + (Math.round(s) % 2 ? -h * 0.02 : h * 0.02) }, 'easeInOut')); return { position: { value: b.pos, keyframes: ks } }; },
  },
  {
    id: 'shake', name: 'Shake', icon: '≋', kind: 'loop',
    build: (t, dur, w) => { const b = base(t); const ks: Keyframe<Vec2>[] = []; let i = 0; for (let s = 0; s <= dur; s += 0.08) ks.push(kf(s, { x: b.pos.x + (i++ % 2 ? w * 0.01 : -w * 0.01), y: b.pos.y + ((i % 3) - 1) * w * 0.004 }, 'linear')); return { position: { value: b.pos, keyframes: ks } }; },
  },
  {
    id: 'rotate', name: 'Rotate', icon: '↻', kind: 'loop',
    build: (t, dur) => { const b = base(t); return { rotation: { value: b.rot, keyframes: [kf(0, b.rot, 'linear'), kf(dur, b.rot + 360 * Math.max(1, Math.round(dur / 4)))] } }; },
  },
  {
    id: 'swing', name: 'Swing', icon: '⟲', kind: 'loop',
    build: (t, dur) => { const b = base(t); const ks: Keyframe<number>[] = []; let i = 0; for (let s = 0; s <= dur; s += 0.6) ks.push(kf(s, b.rot + (i++ % 2 ? 6 : -6), 'easeInOut')); return { rotation: { value: b.rot, keyframes: ks } }; },
  },
];
export const getMotionPreset = (id: string) => MOTION_PRESETS.find((m) => m.id === id);
