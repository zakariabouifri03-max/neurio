// ============================================================================
// NEXUS ENGINE — Audio system (WebAudio)
// 2D + 3D positional playback, volume channels, clip cache.
// ============================================================================
import * as THREE from 'three';

export class AudioSystem {
  ctx: AudioContext | null = null;
  listener: THREE.AudioListener | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  sfxGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loader: ((id: string) => Promise<ArrayBuffer | null>) | null = null;
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  volumes = { master: 0.9, music: 0.6, sfx: 0.9 };
  ready = false;

  setLoader(fn: (assetId: string) => Promise<ArrayBuffer | null>) { this.loader = fn; }

  async ensureContext(): Promise<AudioContext | null> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volumes.master;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.volumes.music;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volumes.sfx;
      this.sfxGain.connect(this.master);
      this.listener = new THREE.AudioListener();
      this.ready = true;
      return this.ctx;
    } catch { return null; }
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.volumes = { master, music, sfx };
    if (this.master) this.master.gain.value = master;
    if (this.musicGain) this.musicGain.gain.value = music;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
  }

  async getBuffer(assetId: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(assetId)) return this.buffers.get(assetId)!;
    if (this.pending.has(assetId)) return this.pending.get(assetId)!;
    if (!this.loader || !this.ctx) return null;
    const p = (async () => {
      const raw = await this.loader(assetId);
      if (!raw) return null;
      try {
        const buf = await this.ctx!.decodeAudioData(raw.slice(0));
        this.buffers.set(assetId, buf);
        return buf;
      } catch { return null; }
    })();
    this.pending.set(assetId, p);
    const result = await p;
    this.pending.delete(assetId);
    return result;
  }

  /** Fire-and-forget 2D play. */
  async play2D(assetId: string, opts: { volume?: number; loop?: boolean; channel?: 'sfx' | 'music' } = {}) {
    const ctx = await this.ensureContext();
    if (!ctx) return null;
    const buf = await this.getBuffer(assetId);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 0.8;
    src.connect(gain);
    gain.connect(opts.channel === 'music' ? this.musicGain! : this.sfxGain!);
    src.start();
    return { source: src, gain, stop: () => { try { src.stop(); } catch { } } };
  }

  /** Positional audio attached to a three object. */
  async play3D(assetId: string, attachTo: THREE.Object3D, opts: { volume?: number; loop?: boolean; minDistance?: number; maxDistance?: number; rolloff?: number } = {}) {
    const ctx = await this.ensureContext();
    if (!ctx || !this.listener) return null;
    const buf = await this.getBuffer(assetId);
    if (!buf) return null;
    const sound = new THREE.PositionalAudio(this.listener);
    sound.setBuffer(buf);
    sound.setVolume(opts.volume ?? 0.8);
    sound.setLoop(!!opts.loop);
    sound.setRefDistance(opts.minDistance ?? 2);
    sound.setMaxDistance(opts.maxDistance ?? 40);
    sound.setRolloffFactor(opts.rolloff ?? 1.5);
    if (attachTo.parent !== null || true) attachTo.add(sound);
    sound.play();
    return { stop: () => { try { sound.stop(); } catch { } attachTo.remove(sound); } };
  }

  dispose() {
    this.buffers.clear();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
}
