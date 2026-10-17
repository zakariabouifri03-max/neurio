export class RabonaAudio {
  constructor(enabled=true) {
    this.enabled = enabled;
    this.ctx = null;
    this.volume = 0.6;
  }
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22 * this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state==='suspended') this.ctx.resume().catch(()=>{});
  }
  tone(freq, dur=0.12, vol=0.18, endFreq=freq, type='sine') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq!==freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq), t+dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t+dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t+dur);
  }
  kick(isRabona=false) {
    if (isRabona) {
      this.tone(320, 0.08, 0.28, 180, 'square');
      setTimeout(()=>this.tone(640, 0.12, 0.22, 880, 'sine'), 60);
    } else {
      this.tone(180, 0.09, 0.35, 80, 'square');
      this.tone(520, 0.07, 0.18, 420, 'sine');
    }
  }
  slide() {
    this.tone(120, 0.22, 0.22, 40, 'sawtooth');
  }
  bump() {
    this.tone(90, 0.15, 0.25, 30, 'square');
  }
  goal() {
    [440,554,659,880].forEach((f,i)=>setTimeout(()=>this.tone(f,0.5,0.26, f*1.1), i*120));
    setTimeout(()=>{
      this.tone(880,0.8,0.28,1320,'sine');
    }, 500);
  }
  whistle() {
    this.tone(1200,0.35,0.28,1800,'sine');
    setTimeout(()=>this.tone(1400,0.35,0.24,2000,'sine'),200);
  }
  click() { this.tone(700,0.06,0.15,500); }
  stop() {}
}
