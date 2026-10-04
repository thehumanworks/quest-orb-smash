// All sounds are synthesised live with the Web Audio API: no audio files.
const PENTA = [0, 2, 4, 7, 9];

export class Sfx {
  constructor() { this.ctx = null; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = 0.7;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp);
      comp.connect(c.destination);
      const len = Math.floor(c.sampleRate * 0.6);
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ok() { return this.ctx && this.ctx.state === 'running'; }

  tone(freq, dur, type = 'sine', vol = 0.3, when = 0, slideTo = 0) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  noiseBurst(dur, vol, type, f0, f1, when = 0, q = 1) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // Pitch climbs a pentatonic scale as your combo grows.
  hit(combo) {
    const n = Math.min(combo, 22);
    const semis = PENTA[n % 5] + 12 * Math.floor(n / 5);
    const f = 220 * Math.pow(2, semis / 12);
    this.tone(f, 0.24, 'triangle', 0.3);
    this.tone(f * 2, 0.14, 'sine', 0.14);
    this.tone(f * 3, 0.06, 'square', 0.035);
    this.noiseBurst(0.06, 0.35, 'bandpass', 4200, 700, 0, 0.8);
    this.tone(90, 0.09, 'sine', 0.35, 0, 45); // thump
  }
  gold() {
    [0, 4, 7, 12, 16, 19].forEach((s, i) => this.tone(880 * Math.pow(2, s / 12), 0.3, 'sine', 0.17, i * 0.04));
    this.noiseBurst(0.35, 0.18, 'highpass', 6000, 9000);
    this.tone(110, 0.15, 'sine', 0.4, 0, 50);
  }
  bomb() {
    this.noiseBurst(0.6, 0.8, 'lowpass', 3500, 60, 0, 0.7);
    this.tone(140, 0.55, 'sawtooth', 0.3, 0, 30);
    this.tone(70, 0.6, 'square', 0.18, 0.02, 25);
  }
  comboUp(mult) {
    const f = 440 * Math.pow(2, (mult * 2) / 12);
    this.tone(f, 0.12, 'square', 0.08);
    this.tone(f * 1.5, 0.18, 'square', 0.08, 0.07);
  }
  comboBreak() { this.tone(330, 0.25, 'triangle', 0.12, 0, 160); }
  oppHit() { this.tone(330, 0.12, 'triangle', 0.08); this.noiseBurst(0.04, 0.1, 'bandpass', 2500, 600); }
  beep(hi) { this.tone(hi ? 1046 : 660, hi ? 0.4 : 0.13, 'square', 0.1); }
  ready() { this.tone(660, 0.08, 'sine', 0.2); this.tone(990, 0.12, 'sine', 0.2, 0.08); }
  join() { this.tone(523, 0.12, 'sine', 0.25); this.tone(784, 0.12, 'sine', 0.25, 0.1); this.tone(1046, 0.2, 'sine', 0.25, 0.2); }
  leave() { this.tone(523, 0.2, 'sine', 0.2, 0, 260); }
  win() { [0, 4, 7, 12].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.5, 'triangle', 0.22, i * 0.11)); }
  lose() { [7, 4, 0, -5].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), 0.4, 'triangle', 0.18, i * 0.14)); }
}
