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
  private curves = new Map<number, Float32Array>();
  private crackle: AudioBuffer | null = null;
  private hum: GainNode | null = null;

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
    if (this.muted) this.setBeams(0);
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

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, dur: number, out: AudioNode, rev = false, freqEnd = 0, q = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd > 0) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
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

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, out: AudioNode = this.sfx) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    o.connect(g).connect(out);
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

  /** Legacy entry point, kept so older callers still make a sound. */
  shoot(kind: 'dart' | 'zap' | 'rail' | 'boom' | 'laser' | 'big', pan = 0) {
    switch (kind) {
      case 'dart': this.dart(pan); break;
      case 'zap': this.arcane(pan); break;
      case 'rail': this.railgun(pan); break;
      case 'boom': this.boulderSmash(1, pan, null); break;
      case 'laser': this.beamZap(pan, null); break;
      case 'big': this.jackpot(pan); break;
    }
  }

  // ---------------- attack sfx ----------------
  // Each attack has its own synthesized voice. `pan` is -1 (left of screen) to 1 (right).

  private panner(pan: number, rev = 0): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.8;
    p.connect(this.sfx);
    if (rev > 0) {
      const g = ctx.createGain();
      g.gain.value = rev;
      p.connect(g).connect(this.reverb);
    }
    return p;
  }

  private drive(out: AudioNode, amount = 6): AudioNode {
    const ctx = this.ctx!;
    let curve = this.curves.get(amount);
    if (!curve) {
      curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
      }
      this.curves.set(amount, curve);
    }
    const ws = ctx.createWaveShaper();
    ws.curve = curve;
    ws.oversample = '2x';
    ws.connect(out);
    return ws;
  }

  /** Sparse random clicks, the raw material of electric crackle. */
  private crackleBuf(): AudioBuffer {
    if (this.crackle) return this.crackle;
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = b.getChannelData(0);
    let env = 0;
    for (let i = 0; i < d.length; i++) {
      if (Math.random() < 0.004) env = 0.4 + Math.random() * 0.6;
      env *= 0.985;
      d[i] = (Math.random() * 2 - 1) * env;
    }
    this.crackle = b;
    return b;
  }

  private crack(t: number, vol: number, dur: number, out: AudioNode, hp = 1800) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.crackleBuf();
    src.playbackRate.value = 0.8 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    this.env(g, t, 0.001, vol, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.05);
  }

  /** Chain lightning: a sharp snap, a buzzing arc that jumps in pitch, a crackle per hop and a thunder tail. */
  lightning(jumps: number, pan = 0) {
    if (!this.ok('lightning', 0.09)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panner(pan, 0.25);
    this.noiseHit(t, 'highpass', 3500, 0.55, 0.05, out);
    // buzzing arc: a sawtooth whose pitch hops around like a sample-and-hold
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const dur = 0.16 + jumps * 0.05;
    for (let k = 0; k < dur; k += 0.012) o.frequency.setValueAtTime(90 + Math.random() * 900, t + k);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.16, dur);
    o.connect(bp).connect(g).connect(this.drive(out, 4));
    o.start(t);
    o.stop(t + dur + 0.05);
    for (let i = 0; i < jumps; i++) this.crack(t + i * 0.045, 0.5 - i * 0.05, 0.09, out);
    // distant thunder
    this.noiseHit(t + 0.03, 'lowpass', 260, 0.35, 0.55, out, true, 90);
  }

  /** Frost: a crystalline tinkle of inharmonic partials, a cold whoosh and a couple of ice cracks. */
  frost(pan = 0, big = true) {
    if (!this.ok(big ? 'frost' : 'frostS', big ? 0.12 : 0.18)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan, 0.5);
    const partials = big ? 7 : 3;
    for (let i = 0; i < partials; i++) {
      const f = 2200 + Math.random() * 4200;
      this.tone('sine', f, f * 0.985, 0.25 + Math.random() * 0.35, (big ? 0.06 : 0.04) * (1 - i / (partials + 2)), i * 0.025 + Math.random() * 0.02, out);
    }
    this.tone('triangle', 1760, 1740, 0.3, big ? 0.05 : 0.03, 0, out);
    this.noiseHit(t, 'bandpass', 7000, big ? 0.35 : 0.18, big ? 0.45 : 0.22, out, false, 1600, 1.5);
    if (big) {
      for (let i = 0; i < 3; i++) this.noiseHit(t + 0.03 + i * 0.05 + Math.random() * 0.03, 'highpass', 4500, 0.4 - i * 0.1, 0.03, out);
      this.tone('sine', 300, 140, 0.25, 0.12, 0, out);
    }
  }

  boulderLaunch(pan = 0) {
    if (!this.ok('blaunch', 0.12)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan);
    this.tone('sine', 130, 55, 0.16, 0.35, 0, out);
    this.noiseHit(t, 'bandpass', 700, 0.35, 0.28, out, false, 180, 2);
  }

  /** Boulder smash: a driven sub boom, a crunchy noise body, then debris rattling down. */
  boulderSmash(size: number, pan: number, el: 'H' | 'S' | 'C' | 'D' | null) {
    if (!this.ok('smash', 0.1)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panner(pan, 0.35);
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(120, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const bg = ctx.createGain();
    this.env(bg, t, 0.003, 0.9 * Math.min(1.3, size), 0.55);
    boom.connect(bg).connect(this.drive(out, 5));
    boom.start(t);
    boom.stop(t + 0.65);
    this.noiseHit(t, 'lowpass', 2200, 0.8, 0.45, out, false, 160);
    this.noiseHit(t, 'bandpass', 900, 0.4, 0.12, out, false, 0, 0.8);
    // debris: little bandpassed ticks landing and bouncing
    for (let i = 0; i < 9; i++) {
      const dt = 0.12 + Math.random() * 0.7;
      this.noiseHit(t + dt, 'bandpass', 1400 + Math.random() * 2600, 0.22 * (1 - dt), 0.025, out, false, 0, 4);
    }
    if (el === 'C') this.frost(pan, true);
    else if (el === 'H') this.fireWhoosh(pan);
    else if (el === 'S') this.bubbles(pan);
    else if (el === 'D') this.shatter(pan);
  }

  fireWhoosh(pan = 0) {
    if (!this.ok('fire', 0.12)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan, 0.2);
    this.noiseHit(t, 'lowpass', 300, 0.5, 0.5, out, false, 2600);
    this.crack(t + 0.05, 0.25, 0.4, out, 900);
  }

  bubbles(pan = 0) {
    if (!this.ok('bubbles', 0.15)) return;
    const out = this.panner(pan);
    for (let i = 0; i < 6; i++) {
      const f = 300 + Math.random() * 500;
      this.tone('sine', f, f * 2.2, 0.06, 0.08, i * 0.05 + Math.random() * 0.04, out);
    }
  }

  shatter(pan = 0) {
    if (!this.ok('shatter', 0.12)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan, 0.4);
    this.noiseHit(t, 'highpass', 5000, 0.5, 0.12, out);
    for (let i = 0; i < 6; i++) {
      const f = 3000 + Math.random() * 4500;
      this.tone('sine', f, f, 0.15, 0.04, Math.random() * 0.2, out);
    }
  }

  /** Bass Drop: a distorted sub sweep with a wub and a slap on top. */
  bassDrop(pan = 0) {
    if (!this.ok('bassdrop', 0.2)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panner(pan, 0.3);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.7);
    const g = ctx.createGain();
    this.env(g, t, 0.004, 0.9, 0.75);
    o.connect(g).connect(this.drive(out, 8));
    o.start(t);
    o.stop(t + 0.8);
    // wub: a saw through a wobbling lowpass
    const w = ctx.createOscillator();
    w.type = 'sawtooth';
    w.frequency.value = 55;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 8;
    f.frequency.value = 400;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const lg = ctx.createGain();
    lg.gain.value = 320;
    lfo.connect(lg).connect(f.frequency);
    const wg = ctx.createGain();
    this.env(wg, t, 0.01, 0.25, 0.55);
    w.connect(f).connect(wg).connect(out);
    w.start(t); lfo.start(t);
    w.stop(t + 0.65); lfo.stop(t + 0.65);
    this.noiseHit(t, 'highpass', 1200, 0.35, 0.12, out);
  }

  /** Railgun: a rising charge chirp, a hard crack and a falling metallic tail. */
  railgun(pan = 0) {
    if (!this.ok('rail', 0.15)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan, 0.3);
    this.tone('sawtooth', 300, 3200, 0.07, 0.07, 0, out);
    this.noiseHit(t + 0.07, 'highpass', 2500, 0.7, 0.08, out);
    this.tone('square', 2600, 70, 0.4, 0.09, 0.07, this.drive(out, 3));
    this.tone('sine', 90, 30, 0.35, 0.45, 0.07, out);
    this.tone('sine', 5200, 4800, 0.5, 0.025, 0.08, out);
  }

  /** Rapid dart: a short pew with random pitch so a stream never sounds like a machine gun loop. */
  dart(pan = 0) {
    if (!this.ok('dart', 0.05)) return;
    const f = 1200 + Math.random() * 600;
    const out = this.panner(pan);
    this.tone('square', f, f * 0.3, 0.06, 0.045, 0, out);
    this.noiseHit(this.ctx!.currentTime, 'highpass', 6000, 0.08, 0.02, out);
  }

  /** Ricochet hit: a metallic ping with inharmonic partials. */
  ping(pan = 0) {
    if (!this.ok('ping', 0.06)) return;
    const out = this.panner(pan, 0.2);
    const f = 2400 + Math.random() * 1200;
    this.tone('sine', f, f * 0.92, 0.18, 0.05, 0, out);
    this.tone('sine', f * 1.47, f * 1.4, 0.12, 0.03, 0, out);
  }

  /** Magic bolts: an FM bell that sweeps up. */
  arcane(pan = 0) {
    if (!this.ok('arcane', 0.08)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.panner(pan, 0.3);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const base = 600 + Math.random() * 200;
    car.frequency.setValueAtTime(base, t);
    car.frequency.exponentialRampToValueAtTime(base * 2.2, t + 0.15);
    mod.frequency.value = base * 1.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(base * 2, t);
    mg.gain.exponentialRampToValueAtTime(10, t + 0.2);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.004, 0.08, 0.22);
    car.connect(g).connect(out);
    car.start(t); mod.start(t);
    car.stop(t + 0.3); mod.stop(t + 0.3);
  }

  /** Short zap at the contact point of a beam, flavored by the suit. */
  beamZap(pan: number, el: 'H' | 'S' | 'C' | 'D' | null) {
    if (!this.ok('beamzap', 0.25)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan);
    this.crack(t, 0.18, 0.12, out, 2500);
    if (el === 'C') this.frost(pan, false);
    else if (el === 'H') this.noiseHit(t, 'lowpass', 500, 0.2, 0.2, out, false, 1800);
    else if (el === 'S') this.tone('sine', 400, 900, 0.06, 0.05, 0, out);
    else if (el === 'D') this.tone('sine', 4200, 4200, 0.1, 0.03, 0, out);
  }

  /** Continuous laser hum, its loudness follows how many beams are firing. */
  setBeams(n: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.hum) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1100;
      f.Q.value = 3;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lg = ctx.createGain();
      lg.gain.value = 300;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
      for (const [type, freq] of [['sawtooth', 110], ['sawtooth', 110.8], ['square', 220.5]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.connect(f);
        o.start();
      }
      f.connect(g).connect(this.sfx);
      this.hum = g;
    }
    const target = n > 0 && !this.muted ? 0.035 + Math.min(n, 4) * 0.012 : 0;
    this.hum.gain.setTargetAtTime(target, ctx.currentTime, 0.06);
  }

  /** Jackpot: a heavy coin smash and a cascade of bright chimes. */
  jackpot(pan = 0) {
    if (!this.ok('jackpot', 0.2)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan, 0.4);
    this.tone('triangle', 900, 200, 0.25, 0.12, 0, out);
    this.tone('sine', 110, 40, 0.3, 0.4, 0, out);
    this.noiseHit(t, 'bandpass', 4200, 0.3, 0.06, out);
    [1568, 2093, 2637, 3136].forEach((f, i) => this.tone('sine', f, f, 0.14, 0.06, 0.04 + i * 0.04, out));
  }

  /** Bright sting for a diamond crit. */
  crit(pan = 0) {
    if (!this.ok('crit', 0.1)) return;
    const out = this.panner(pan, 0.4);
    this.tone('square', 1760, 1760, 0.06, 0.05, 0, out);
    this.tone('square', 2637, 2637, 0.12, 0.05, 0.05, out);
  }

  /** Light physical impact on an enemy. */
  thud(pan = 0) {
    if (!this.ok('thud', 0.05)) return;
    const t = this.ctx!.currentTime;
    const out = this.panner(pan);
    this.noiseHit(t, 'bandpass', 1200 + Math.random() * 600, 0.18, 0.04, out, false, 0, 2);
    this.tone('sine', 220, 90, 0.05, 0.08, 0, out);
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
