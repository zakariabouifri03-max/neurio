// ---------- synthesized SFX (Web Audio, zero files) ----------
let ctx = null, master = null, engine = null;
let vol = 0.8;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) { vol = v; if (master) master.gain.value = v; }

function blip(freq, dur, type = 'square', gain = 0.15, slide = 0) {
  const c = ac();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(master);
  o.start(); o.stop(c.currentTime + dur + 0.02);
}

export const sClick = () => blip(700, 0.06, 'square', 0.08);
export const sBack = () => blip(420, 0.08, 'square', 0.08);
export const sErr = () => { blip(180, 0.18, 'sawtooth', 0.12, -60); };
export const sBuy = () => { blip(660, 0.09, 'square', 0.1); setTimeout(() => blip(880, 0.12, 'square', 0.1), 90); setTimeout(() => blip(1320, 0.2, 'square', 0.1), 190); };
export const sCash = () => { blip(1200, 0.05, 'triangle', 0.12); setTimeout(() => blip(1600, 0.09, 'triangle', 0.12), 60); };
export const sDoor = () => blip(140, 0.2, 'sine', 0.2, -40);
export const sNotify = () => { blip(980, 0.08, 'sine', 0.12); setTimeout(() => blip(1240, 0.14, 'sine', 0.12), 100); };
export const sLive = () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.12), i * 110)); };

// ---- car engine loop ----
export function engineStart() {
  const c = ac();
  if (engine) return;
  const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o1.type = 'sawtooth'; o2.type = 'square';
  o1.frequency.value = 55; o2.frequency.value = 28;
  f.type = 'lowpass'; f.frequency.value = 400;
  g.gain.value = 0.0;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
  o1.start(); o2.start();
  engine = { o1, o2, g, f };
}
export function engineUpdate(speed01, dt) {
  if (!engine) return;
  const c = ac();
  const rpm = 50 + speed01 * 160;
  engine.o1.frequency.setTargetAtTime(rpm, c.currentTime, 0.1);
  engine.o2.frequency.setTargetAtTime(rpm * 0.5, c.currentTime, 0.1);
  engine.f.frequency.setTargetAtTime(300 + speed01 * 900, c.currentTime, 0.15);
  engine.g.gain.setTargetAtTime(0.05 + speed01 * 0.09, c.currentTime, 0.1);
}
export function engineStop() {
  if (!engine) return;
  try { engine.o1.stop(); engine.o2.stop(); } catch {}
  engine = null;
}
