// All sound is synthesized with the Web Audio API: SFX and a layered synthwave track.

type Layer = 0 | 1 | 2; // 0 = build (calm), 1 = wave, 2 = boss

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class SoundEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  private nextTime = 0;
  private step = 0;
  private layer: Layer = 0;
  private timer = 0;
  private lastPlayed = new Map<string, number>();
  muted = false;
  private bpm = 104;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.55;
    this.sfx.connect(this.master);

    // generated impulse response for a big neon room
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.35;
    this.reverb.connect(revGain).connect(this.master);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75; // dotted eighth
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createGain();
    dl.gain.value = 0.3;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(dl).connect(this.music);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setLayer(l: Layer) {
    this.layer = l;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  stop() {
    clearInterval(this.timer);
  }

  // ---------------- music ----------------

  private schedule() {
    const ctx = this.ctx!;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const boss = this.layer === 2;
    // Am F C G for build/wave, Am Bb F E for the boss
    const roots = boss ? [45, 46, 41, 40] : [45, 41, 48, 43];
    const quals = boss ? ['m', 'M', 'M', 'M'] : ['m', 'M', 'M', 'M'];
    const root = roots[bar];
    const third = quals[bar] === 'm' ? 3 : 4;
    const chord = [0, third, 7, 12].map((i) => root + 12 + i);

    if (s === 0) this.pad(chord, t, sd * 16);

    // arpeggio, always present, louder during waves
    const arpOrder = [0, 1, 2, 3, 2, 1, 0, 2];
    const arpNote = chord[arpOrder[s % 8]] + 12 + (s >= 8 && this.layer > 0 ? 12 : 0);
    this.arp(arpNote, t, sd * 0.9, this.layer === 0 ? 0.05 : 0.07);

    if (this.layer >= 1) {
      if (s % 4 === 0) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 1 || (boss && s % 2 === 0 && s % 4 !== 0)) this.hat(t, s % 4 === 2 ? 0.07 : 0.05);
      // eighth-note bass, octave pump
      if (s % 2 === 0) this.bass(root - 12 + (s % 4 === 2 ? 12 : 0), t, sd * 1.7);
    }
    if (boss) {
      const lead = [0, -1, 3, -1, 7, -1, 5, 3, 0, -1, 12, -1, 10, 7, 5, -1];
      if (lead[s] >= 0) this.lead(root + 24 + lead[s], t, sd * 1.8);
    }
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private pad(notes: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.layer === 2 ? 1600 : 1100;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.5);
    g.gain.setValueAtTime(0.05, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    for (const n of notes.slice(0, 3)) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private arp(n: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midi(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(f).connect(g);
    g.connect(this.music);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bass(n: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(this.layer === 2 ? 1400 : 900, t);
    f.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.01, 0.22, dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private lead(n: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midi(n);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vg = ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg).connect(o.detune);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    const g = ctx.createGain();
    this.env(g, t, 0.02, 0.07, dur);
    o.connect(f).connect(g);
    g.connect(this.music);
    g.connect(this.reverb);
    g.connect(this.delay);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.9, 0.32);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, dur: number, out: AudioNode, rev = false) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, dur);
    src.connect(f).connect(g).connect(out);
    if (rev) g.connect(this.reverb);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private snare(t: number) {
    this.noiseHit(t, 'highpass', 1400, 0.35, 0.2, this.music, true);
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.25, 0.1);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, vol: number) {
    this.noiseHit(t, 'highpass', 7500, vol, 0.04, this.music);
  }

  // ---------------- sfx ----------------

  private ok(name: string, gap: number): boolean {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if ((this.lastPlayed.get(name) ?? -1) + gap > now) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  flip() {
    if (!this.ok('flip', 0.03)) return;
    this.noiseHit(this.ctx!.currentTime, 'bandpass', 3000, 0.5, 0.06, this.sfx);
    this.tone('triangle', 900, 1400, 0.05, 0.12);
  }

  click() {
    if (!this.ok('click', 0.03)) return;
    this.tone('square', 1200, 900, 0.04, 0.06);
  }

  chip() {
    if (!this.ok('chip', 0.05)) return;
    this.tone('sine', 2200, 2100, 0.08, 0.15);
    this.tone('sine', 3300, 3200, 0.06, 0.08, 0.03);
  }

  shoot(kind: 'dart' | 'zap' | 'rail' | 'boom' | 'laser' | 'big') {
    switch (kind) {
      case 'dart': if (this.ok('dart', 0.06)) this.tone('square', 1400, 500, 0.06, 0.05); break;
      case 'zap': if (this.ok('zap', 0.08)) { this.tone('sawtooth', 2200, 300, 0.12, 0.05); this.noiseHit(this.ctx!.currentTime, 'highpass', 5000, 0.08, 0.08, this.sfx); } break;
      case 'rail': if (this.ok('rail', 0.15)) { this.tone('sawtooth', 200, 2400, 0.12, 0.09); this.tone('square', 2400, 80, 0.3, 0.08, 0.12); } break;
      case 'boom': if (this.ok('boom', 0.15)) { this.noiseHit(this.ctx!.currentTime, 'lowpass', 600, 0.6, 0.4, this.sfx); this.tone('sine', 120, 35, 0.4, 0.5); } break;
      case 'laser': if (this.ok('laser', 0.25)) this.tone('sawtooth', 600, 650, 0.25, 0.03); break;
      case 'big': if (this.ok('big', 0.2)) { this.tone('triangle', 900, 200, 0.25, 0.12); this.tone('sine', 1800, 400, 0.2, 0.08); } break;
    }
  }

  kill() {
    if (!this.ok('kill', 0.05)) return;
    this.tone('square', 660, 660, 0.05, 0.05);
    this.tone('square', 990, 990, 0.08, 0.05, 0.05);
  }

  cash() {
    if (!this.ok('cash', 0.15)) return;
    this.noiseHit(this.ctx!.currentTime, 'bandpass', 4000, 0.25, 0.05, this.sfx);
    [1568, 2093, 2637].forEach((f, i) => this.tone('sine', f, f, 0.12, 0.12, 0.05 + i * 0.05));
  }

  leak() {
    if (!this.ok('leak', 0.2)) return;
    this.tone('sawtooth', 440, 220, 0.25, 0.12);
    this.tone('sawtooth', 330, 165, 0.25, 0.1, 0.12);
  }

  build() {
    if (!this.ctx) return;
    [57, 60, 64, 69, 72].forEach((n, i) => this.tone('square', midi(n + 12), midi(n + 12), 0.1, 0.07, i * 0.05));
    this.noiseHit(this.ctx.currentTime, 'lowpass', 800, 0.4, 0.25, this.sfx);
  }

  reroll() {
    if (!this.ctx) return;
    for (let i = 0; i < 6; i++) this.noiseHit(this.ctx.currentTime + i * 0.035, 'bandpass', 2500 + i * 300, 0.3, 0.04, this.sfx);
  }

  tip() {
    if (!this.ok('tip', 0.05)) return;
    this.tone('sine', 1760, 1760, 0.08, 0.1);
    this.tone('sine', 2637, 2637, 0.12, 0.08, 0.07);
  }

  wave() {
    if (!this.ctx) return;
    [45, 52, 57].forEach((n, i) => this.tone('sawtooth', midi(n + 12), midi(n + 12), 0.25, 0.08, i * 0.12));
  }

  bossRoar() {
    if (!this.ctx) return;
    this.tone('sawtooth', 110, 40, 1.4, 0.3);
    this.tone('square', 82, 30, 1.6, 0.2);
    this.noiseHit(this.ctx.currentTime, 'lowpass', 400, 0.6, 1.2, this.sfx, true);
  }

  slotSpin() {
    if (!this.ctx) return;
    for (let i = 0; i < 12; i++) this.tone('square', 900 + (i % 3) * 300, 900, 0.03, 0.05, i * 0.06);
    this.tone('triangle', 1318, 1318, 0.2, 0.12, 0.8);
  }

  shieldHit() {
    if (!this.ok('shield', 0.07)) return;
    this.tone('triangle', 2400, 1800, 0.07, 0.06);
  }

  steal() {
    if (!this.ctx) return;
    this.tone('sawtooth', 1200, 200, 0.4, 0.12);
  }

  win() {
    if (!this.ctx) return;
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone('square', midi(n + 12), midi(n + 12), 0.18, 0.08, i * 0.1));
  }

  lose() {
    if (!this.ctx) return;
    [64, 60, 57, 52].forEach((n, i) => this.tone('sawtooth', midi(n), midi(n) * 0.97, 0.35, 0.1, i * 0.25));
  }
}

export const audio = new SoundEngine();
