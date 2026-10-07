// Real-time playback loop (time-based, drops frames to keep sync with audio).
import { S, bus, scene, fps, sceneDuration } from './state.js';
import { startAudio, stopAudio } from './audio.js';

let t0 = 0, f0 = 0, handle = 0, last = -1;
export const Playback = {
  range: null, // {start,end} loop range (inclusive) or null
  get end() { return this.range ? this.range.end : sceneDuration() - 1; },
  get start() { return this.range ? this.range.start : 0; },
  play() {
    if (S.playing) return; const end = this.end; if (S.frame >= end) S.frame = this.start;
    S.playing = true; t0 = performance.now(); f0 = S.frame; last = S.frame; startAudio(S.frame);
    bus.emit('playing'); handle = requestAnimationFrame(tick);
  },
  pause() { if (!S.playing) return; S.playing = false; cancelAnimationFrame(handle); stopAudio(); bus.emit('playing'); bus.emit('frame'); bus.emit('render'); },
  toggle() { S.playing ? this.pause() : this.play(); },
  stop() { this.pause(); S.frame = this.start; bus.emit('frame'); bus.emit('render'); },
  seek(f) { f = Math.max(0, Math.round(f)); if (S.playing) { S.frame = f; t0 = performance.now(); f0 = f; startAudio(f); } else S.frame = f; bus.emit('frame'); bus.emit('render'); },
};
function tick(now) {
  if (!S.playing) return;
  const F = fps(); let f = f0 + Math.floor((now - t0) / 1000 * F);
  const start = Playback.start, end = Playback.end;
  if (f > end) {
    if (S.loop) { f = start + ((f - start) % (end - start + 1)); t0 = now; f0 = start; startAudio(start); }
    else { S.frame = end; Playback.pause(); return; }
  }
  if (f !== last) { S.frame = f; last = f; bus.emit('frame'); bus.emit('render'); }
  handle = requestAnimationFrame(tick);
}
