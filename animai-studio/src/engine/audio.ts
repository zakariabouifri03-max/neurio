import { AnimationDocument } from "./document";
import { uid } from "../core/ids";
import { AudioClip } from "../core/types";
import { fileToDataUrl } from "../io/import";
import { log } from "../core/logger";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private buffers = new Map<string, AudioBuffer>();
  recording: MediaRecorder | null = null;
  chunks: Blob[] = [];

  private ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  async importFile(doc: AnimationDocument, file: File, startFrame = 0): Promise<AudioClip> {
    const dataUrl = await fileToDataUrl(file);
    const clip: AudioClip = {
      id: uid("au"),
      name: file.name,
      startFrame,
      durationMs: 0,
      volume: 1,
      muted: false,
      dataUrl,
    };
    await this.decode(clip);
    doc.audio.push(clip);
    doc.mark("audio-import");
    return clip;
  }

  async decode(clip: AudioClip): Promise<void> {
    const ctx = this.ensure();
    const res = await fetch(clip.dataUrl);
    const buf = await res.arrayBuffer();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    this.buffers.set(clip.id, audio);
    clip.durationMs = audio.duration * 1000;
  }

  waveform(clip: AudioClip, width: number, height: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#121722";
    ctx.fillRect(0, 0, width, height);
    const buf = this.buffers.get(clip.id);
    if (!buf) return c;
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    ctx.strokeStyle = "#7c6cff";
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      let min = 1;
      let max = -1;
      for (let i = 0; i < step; i++) {
        const v = data[x * step + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = ((min + 1) / 2) * height;
      const y2 = ((max + 1) / 2) * height;
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
    }
    ctx.stroke();
    return c;
  }

  play(doc: AnimationDocument, fromFrame: number): void {
    this.stop();
    const ctx = this.ensure();
    void ctx.resume();
    const t0 = ctx.currentTime;
    const startSec = fromFrame / doc.fps;
    for (const clip of doc.audio) {
      if (clip.muted) continue;
      const buf = this.buffers.get(clip.id);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = clip.volume;
      src.connect(gain).connect(ctx.destination);
      const clipStart = clip.startFrame / doc.fps;
      const offset = Math.max(0, startSec - clipStart);
      if (offset < buf.duration) src.start(t0, offset);
      this.sources.push(src);
    }
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }

  async startRecording(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recording = new MediaRecorder(stream);
    this.recording.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recording.start();
  }

  async stopRecording(doc: AnimationDocument): Promise<void> {
    const rec = this.recording;
    if (!rec) return;
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    });
    this.recording = null;
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
    await this.importFile(doc, file, doc.currentFrame);
    log.info("Voice recorded");
  }
}
