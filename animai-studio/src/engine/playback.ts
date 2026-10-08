import { AnimationDocument } from "./document";

export class PlaybackController {
  private raf = 0;
  private acc = 0;
  private last = 0;
  private playhead = 0;
  onFrame: (frame: number) => void = () => {};

  start(doc: AnimationDocument): void {
    if (doc.playing) return;
    doc.playing = true;
    this.last = performance.now();
    this.playhead = 0;
    for (let i = 0; i < doc.currentFrame; i++) this.playhead += doc.frames[i].hold;
    const loop = (now: number) => {
      if (!doc.playing) return;
      const dt = now - this.last;
      this.last = now;
      this.acc += dt;
      const step = 1000 / doc.fps;
      while (this.acc >= step) {
        this.acc -= step;
        this.playhead = (this.playhead + 1) % Math.max(1, doc.playbackLength());
        const f = doc.frameAtPlayhead(this.playhead);
        if (f !== doc.currentFrame) {
          doc.setFrame(f);
          this.onFrame(f);
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    doc.events.emit("play", { playing: true });
  }

  stop(doc: AnimationDocument): void {
    doc.playing = false;
    cancelAnimationFrame(this.raf);
    doc.events.emit("play", { playing: false });
    doc.events.emit("change", { reason: "pause" });
  }

  toggle(doc: AnimationDocument): void {
    if (doc.playing) this.stop(doc);
    else this.start(doc);
  }
}
