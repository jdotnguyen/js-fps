/** Synthesized sound effects. Every method is a no-op until `init()` succeeds. */
export class Sfx {
  constructor() {
    this.ctx = null;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  tone(from, to, dur, type = 'square', vol = 0.3, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, vol = 0.3, cutoff = 2000, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.15), t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  rifle() { this.tone(520, 90, 0.09, 'square', 0.16); this.noise(0.09, 0.28, 5000); }
  shotgun() { this.tone(220, 40, 0.22, 'sawtooth', 0.25); this.noise(0.28, 0.5, 3200); }
  empty() { this.tone(900, 700, 0.03, 'square', 0.1); }
  reload() { this.tone(300, 320, 0.04, 'square', 0.12); this.tone(420, 460, 0.05, 'square', 0.12, 0.18); }
  hit() { this.tone(1100, 700, 0.05, 'triangle', 0.22); }
  kill() { this.tone(700, 1400, 0.09, 'square', 0.16); this.tone(1400, 2100, 0.1, 'square', 0.14, 0.07); }
  hurt() { this.tone(180, 70, 0.2, 'sawtooth', 0.3); this.noise(0.12, 0.2, 900); }
  pickup() { this.tone(660, 880, 0.08, 'triangle', 0.25); this.tone(990, 1320, 0.12, 'triangle', 0.25, 0.08); }
  enemyShot() { this.tone(900, 300, 0.14, 'sine', 0.14); }
  wave() { [392, 523, 659].forEach((f, i) => this.tone(f, f, 0.14, 'square', 0.16, i * 0.11)); }
  gameOver() { [440, 349, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.22, 'sawtooth', 0.2, i * 0.18)); }
}
