import { env, noiseSource, thud } from './synth';

/**
 * The score, synthesized and sequenced live with a look-ahead scheduler (D minor, 72 BPM).
 *   title   : low drone and a slow choir
 *   fight 1 : choir, drone, sparse war drums
 *   fight 2 : + a pulsing bass ostinato, busier drums
 *   fight 3 : + tremolo strings high above, driving drums
 *   victory : the progression resolves to D major under bells, then silence
 *   death   : a low dissonant swell that dies away
 */
export type MusicMode = 'off' | 'title' | 'fight' | 'victory' | 'death';

const BPM = 72;
const EIGHTH = 60 / BPM / 2;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// D2 = 38. Progression (two bars each): Dm, Bb, Gm, A
const CHORDS: number[][] = [
  [50, 53, 57, 62], // Dm: D3 F3 A3 D4
  [46, 50, 53, 58], // Bb: Bb2 D3 F3 Bb3
  [43, 50, 55, 58], // Gm: G2 D3 G3 Bb3
  [45, 52, 57, 61], // A:  A2 E3 A3 C#4
];
const ROOTS = [38, 34, 31, 33];

export class Music {
  readonly out: GainNode;
  private mode: MusicMode = 'off';
  private phase = 1;
  private step = 0;
  private next = 0;
  private timer: number | null = null;
  private pad: { gains: GainNode[]; stop: number } | null = null;
  private drone: { stop: () => void; gain: GainNode } | null = null;
  /** 0..1: how much the fight is going on (drums drop while the golem is down) */
  heat = 1;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
  }

  setMode(mode: MusicMode, phase = 1): void {
    const prev = this.mode;
    this.phase = phase;
    if (mode === prev) return;
    this.mode = mode;
    const t = this.ctx.currentTime;
    if (mode === 'victory') {
      this.stopLoop(t, 1.2);
      this.victory(t + 0.3);
      return;
    }
    if (mode === 'death') {
      this.stopLoop(t, 0.6);
      this.death(t + 0.1);
      return;
    }
    if (mode === 'off') {
      this.stopLoop(t, 1.5);
      return;
    }
    // title or fight: (re)start the loop on the next bar
    if (this.timer === null) {
      this.step = 0;
      this.next = t + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    this.ensureDrone(t);
  }

  setPhase(phase: number): void {
    this.phase = phase;
  }

  private stopLoop(t: number, fade: number): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pad) {
      for (const g of this.pad.gains) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + fade);
      }
      this.pad = null;
    }
    if (this.drone) {
      const d = this.drone;
      d.gain.gain.cancelScheduledValues(t);
      d.gain.gain.setValueAtTime(d.gain.gain.value, t);
      d.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
      window.setTimeout(() => d.stop(), (fade + 0.2) * 1000);
      this.drone = null;
    }
  }

  private ensureDrone(t: number): void {
    if (this.drone) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(lp.frequency);
    const oscs = [midi(26), midi(26) * 1.004, midi(33)].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      return o;
    });
    lp.connect(g).connect(this.out);
    lfo.start(t);
    this.drone = {
      gain: g,
      stop: () => {
        for (const o of oscs) o.stop();
        lfo.stop();
      },
    };
  }

  private schedule(): void {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.next);
      this.next += EIGHTH;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 8);
    const inBar = step % 8;
    const chordIdx = Math.floor(bar / 2) % 4;
    if (inBar === 0 && bar % 2 === 0) this.choir(t, CHORDS[chordIdx], EIGHTH * 16);
    if (this.mode !== 'fight') return;
    const heat = this.heat;
    const ph = this.phase;
    // war drums
    const pattern = ph >= 3 ? [1, 0, 0.5, 0.6, 1, 0, 0.7, 0.5] : ph === 2 ? [1, 0, 0, 0.5, 0.8, 0, 0.4, 0] : [1, 0, 0, 0, 0.7, 0, 0, 0];
    const hit = pattern[inBar] * heat;
    if (hit > 0) this.drum(t, hit);
    if (ph >= 3 && inBar % 2 === 1 && heat > 0.5) this.tick(t, 0.25);
    // bass ostinato from phase 2
    if (ph >= 2 && heat > 0.3) {
      const root = ROOTS[chordIdx];
      const figure = [0, 0, 12, 0, 7, 0, 12, 10];
      this.pluck(t, midi(root + figure[inBar]), 0.16 * heat);
    }
    // tremolo strings in phase 3
    if (ph >= 3 && inBar === 0 && bar % 2 === 0) this.strings(t, CHORDS[chordIdx].map((n) => n + 24), EIGHTH * 16, 0.05 * heat);
  }

  private choir(t: number, notes: number[], dur: number): void {
    const ctx = this.ctx;
    const level = this.mode === 'title' ? 0.05 : 0.06;
    const gains: GainNode[] = [];
    const vowel = [
      [700, 5],
      [1150, 7],
      [2600, 9],
    ];
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.linearRampToValueAtTime(level, t + 1.6);
    bus.gain.setValueAtTime(level, t + dur - 1.4);
    bus.gain.linearRampToValueAtTime(0.0001, t + dur + 0.8);
    for (const [f, q] of vowel) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      bp.connect(bus);
      gains.push(bus);
      for (const n of notes) {
        for (const det of [-9, 8]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = midi(n);
          o.detune.value = det;
          o.connect(bp);
          o.start(t);
          o.stop(t + dur + 1);
        }
      }
    }
    bus.connect(this.out);
    this.pad = { gains: [bus], stop: t + dur };
  }

  private drum(t: number, strength: number): void {
    const ctx = this.ctx;
    thud(ctx, { t, out: this.out, gain: 0.5 * strength }, 95, 42, 0.55, 0.35);
    // skin slap
    const n = noiseSource(ctx, 'white');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    const g = env(ctx, t, 0.09 * strength, 0.001, 0.08);
    n.connect(bp).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + 0.15);
  }

  private tick(t: number, strength: number): void {
    const ctx = this.ctx;
    const n = noiseSource(ctx, 'white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = env(ctx, t, 0.05 * strength, 0.001, 0.04);
    n.connect(hp).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + 0.08);
  }

  private pluck(t: number, f: number, level: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.3);
    const g = env(ctx, t, level, 0.005, 0.32);
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  private strings(t: number, notes: number[], dur: number, level: number): void {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.linearRampToValueAtTime(level, t + 0.8);
    bus.gain.setValueAtTime(level, t + dur - 0.6);
    bus.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lg = ctx.createGain();
    lg.gain.value = 0.4;
    lfo.connect(lg).connect(trem.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    for (const n of notes) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.5);
    }
    lp.connect(trem).connect(bus).connect(this.out);
    lfo.start(t);
    lfo.stop(t + dur + 0.5);
  }

  private victory(t: number): void {
    const ctx = this.ctx;
    // Bb -> A -> D major, then bells
    const seq: [number[], number][] = [
      [[46, 50, 53, 58], 0],
      [[45, 52, 57, 61], 2.2],
      [[50, 54, 57, 62, 66], 4.4],
    ];
    for (const [notes, dt] of seq) this.choirOnce(t + dt, notes, dt === 4.4 ? 7 : 2.4, dt === 4.4 ? 0.09 : 0.06);
    [74, 78, 81, 86].forEach((n, i) => {
      const tt = t + 4.6 + i * 0.35;
      [1, 2.76, 5.4].forEach((r, j) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = midi(n) * r;
        const g = env(ctx, tt, 0.06 / (1 + j * 2), 0.002, 3.0 / (1 + j));
        o.connect(g).connect(this.out);
        o.start(tt);
        o.stop(tt + 3.2);
      });
    });
    thud(ctx, { t: t + 4.4, out: this.out, gain: 0.5 }, 90, 40, 1.2, 0.4);
  }

  private death(t: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 5);
    for (const n of [26, 27, 38, 39]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(midi(n), t);
      o.frequency.linearRampToValueAtTime(midi(n) * 0.94, t + 5);
      o.connect(lp);
      o.start(t);
      o.stop(t + 5.2);
    }
    lp.connect(g).connect(this.out);
    thud(ctx, { t, out: this.out, gain: 0.6 }, 70, 30, 1.6, 0.5);
  }

  private choirOnce(t: number, notes: number[], dur: number, level: number): void {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.linearRampToValueAtTime(level, t + 0.6);
    bus.gain.setValueAtTime(level, t + dur * 0.6);
    bus.gain.linearRampToValueAtTime(0.0001, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    for (const n of notes) {
      for (const det of [-8, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(bp);
        o.start(t);
        o.stop(t + dur + 0.2);
      }
    }
    bp.connect(bus).connect(this.out);
  }
}
