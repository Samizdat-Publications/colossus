/**
 * Web Audio building blocks. Every sound in COLOSSUS is synthesized from these at runtime:
 * oscillators, noise buffers, filters and envelopes. No audio files.
 */

export interface Voice {
  /** where to connect (a gain or panner in the engine's graph) */
  out: AudioNode;
  /** start time (context seconds) */
  t: number;
  /** overall level */
  gain: number;
}

let noiseCache: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer } | null = null;

/** Two seconds of white, pink and brown noise, looped wherever noise is needed. */
export function noiseBuffers(ctx: BaseAudioContext): { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer } {
  if (noiseCache && noiseCache.white.sampleRate === ctx.sampleRate) return noiseCache;
  const len = Math.floor(ctx.sampleRate * 2);
  const mk = () => ctx.createBuffer(1, len, ctx.sampleRate);
  const white = mk();
  const pink = mk();
  const brown = mk();
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < len; i++) {
    const x = rnd();
    w[i] = x;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  noiseCache = { white, pink, brown };
  return noiseCache;
}

export function noiseSource(ctx: BaseAudioContext, kind: 'white' | 'pink' | 'brown', loop = true): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffers(ctx)[kind];
  src.loop = loop;
  src.loopStart = Math.random() * 1.5;
  return src;
}

/** A gain node with an attack/decay envelope that ends at t + attack + decay. */
export function env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number, curve: 'exp' | 'lin' = 'exp'): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, attack));
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(0.01, decay));
  else g.gain.linearRampToValueAtTime(0.0001, t + attack + Math.max(0.01, decay));
  return g;
}

function stopAfter(node: AudioScheduledSourceNode, t: number): void {
  node.start(t);
  node.stop(t + 0.05);
}
void stopAfter;

function filt(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

// ------------------------------------------------------------------ one-shots

/** Deep body of an impact: a sine whose pitch falls, plus a low noise burst. Golem steps, slams, stomps. */
export function thud(ctx: BaseAudioContext, v: Voice, f0: number, f1: number, decay: number, noiseAmt = 0.6): void {
  const { t, out, gain } = v;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + decay * 0.8);
  const g = env(ctx, t, gain, 0.004, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.1);
  if (noiseAmt > 0) {
    const n = noiseSource(ctx, 'brown');
    const lp = filt(ctx, 'lowpass', 220, 0.8);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + decay);
    const ng = env(ctx, t, gain * noiseAmt, 0.003, decay * 0.9);
    n.connect(lp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + decay + 0.1);
  }
}

/** Long, very low rumble (brown noise through a low-pass). Slams, collapses, thunder tails. */
export function rumble(ctx: BaseAudioContext, v: Voice, duration: number, cutoff = 120, attack = 0.05): void {
  const { t, out, gain } = v;
  const n = noiseSource(ctx, 'brown');
  const lp = filt(ctx, 'lowpass', cutoff, 0.5);
  const g = env(ctx, t, gain, attack, duration);
  n.connect(lp).connect(g).connect(out);
  n.start(t);
  n.stop(t + attack + duration + 0.1);
}

/** Air moving: band-passed noise sweeping between two frequencies. Swings, sweeps, rolls, flying rocks. */
export function whoosh(ctx: BaseAudioContext, v: Voice, duration: number, fFrom: number, fTo: number, q = 1.2, kind: 'white' | 'pink' = 'pink'): void {
  const { t, out, gain } = v;
  const n = noiseSource(ctx, kind);
  const bp = filt(ctx, 'bandpass', fFrom, q);
  bp.frequency.setValueAtTime(fFrom, t);
  bp.frequency.exponentialRampToValueAtTime(Math.max(40, fTo), t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + duration * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  n.connect(bp).connect(g).connect(out);
  n.start(t);
  n.stop(t + duration + 0.05);
}

/** Struck metal: inharmonic partials with fast decays and a click. Sword on stone, blocks. */
export function clank(ctx: BaseAudioContext, v: Voice, f: number, decay = 0.5, bright = 1): void {
  const { t, out, gain } = v;
  const ratios = [1, 2.76, 5.4, 8.93, 13.34];
  ratios.forEach((r, i) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * r * (1 + (Math.random() - 0.5) * 0.01);
    const g = env(ctx, t, (gain * (bright * 0.6 + 0.4)) / (1 + i * 0.9), 0.001, decay / (1 + i * 0.6));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  });
  const n = noiseSource(ctx, 'white');
  const hp = filt(ctx, 'highpass', 2500, 0.7);
  const ng = env(ctx, t, gain * 0.5 * bright, 0.001, 0.05);
  n.connect(hp).connect(ng).connect(out);
  n.start(t);
  n.stop(t + 0.1);
}

/** Crystal: bell partials with a shimmer. Core hits. */
export function chime(ctx: BaseAudioContext, v: Voice, f: number, decay = 1.2): void {
  const { t, out, gain } = v;
  [1, 2.0, 3.01, 4.2, 5.4].forEach((r, i) => {
    const o = ctx.createOscillator();
    o.type = i === 0 ? 'triangle' : 'sine';
    o.frequency.value = f * r;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + i * 1.7;
    const lg = ctx.createGain();
    lg.gain.value = f * r * 0.004;
    lfo.connect(lg).connect(o.frequency);
    const g = env(ctx, t, gain / (1 + i * 0.7), 0.002, decay / (1 + i * 0.35));
    o.connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + decay + 0.05);
    lfo.stop(t + decay + 0.05);
  });
}

/** Stone breaking: grains of band-passed noise. Deflects, core cracks, debris. */
export function crunch(ctx: BaseAudioContext, v: Voice, duration = 0.25, center = 900, grains = 7): void {
  const { t, out, gain } = v;
  for (let i = 0; i < grains; i++) {
    const tt = t + Math.random() * duration * 0.7;
    const n = noiseSource(ctx, 'white');
    const bp = filt(ctx, 'bandpass', center * (0.5 + Math.random()), 2.5);
    const g = env(ctx, tt, gain * (0.4 + Math.random() * 0.6), 0.001, 0.03 + Math.random() * 0.07);
    n.connect(bp).connect(g).connect(out);
    n.start(tt);
    n.stop(tt + 0.15);
  }
}

/** The golem's voice: low detuned saws with vibrato through vowel formants, over breathy noise. */
export function roar(ctx: BaseAudioContext, v: Voice, duration: number, pitch = 55): void {
  const { t, out, gain } = v;
  const mix = ctx.createGain();
  mix.gain.value = 1;
  const formants = [
    [320, 6],
    [780, 8],
    [2400, 10],
  ].map(([f, q]) => {
    const bp = filt(ctx, 'bandpass', f, q);
    bp.frequency.setValueAtTime(f * 0.8, t);
    bp.frequency.linearRampToValueAtTime(f, t + duration * 0.4);
    bp.frequency.linearRampToValueAtTime(f * 0.7, t + duration);
    return bp;
  });
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + duration * 0.2);
  g.gain.setValueAtTime(gain, t + duration * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  for (const f of formants) mix.connect(f).connect(g);
  const low = filt(ctx, 'lowpass', 180, 0.7);
  mix.connect(low).connect(g);
  g.connect(out);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 7.5;
  const lg = ctx.createGain();
  lg.gain.value = pitch * 0.05;
  lfo.connect(lg);
  for (const d of [-7, 0, 6, 12.5]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch * 0.85, t);
    o.frequency.linearRampToValueAtTime(pitch, t + duration * 0.3);
    o.frequency.linearRampToValueAtTime(pitch * 0.78, t + duration);
    o.detune.value = d * 10;
    lg.connect(o.frequency);
    o.connect(mix);
    o.start(t);
    o.stop(t + duration + 0.1);
  }
  lfo.start(t);
  lfo.stop(t + duration + 0.1);
  const n = noiseSource(ctx, 'pink');
  const nb = filt(ctx, 'bandpass', 500, 0.8);
  const ng = ctx.createGain();
  ng.gain.value = 0.5;
  n.connect(nb).connect(ng).connect(mix);
  n.start(t);
  n.stop(t + duration + 0.1);
}

/** Thunder: a sharp crack (if close), then rolling low noise for seconds. */
export function thunder(ctx: BaseAudioContext, v: Voice, distance: number): void {
  const { t, out, gain } = v;
  const near = Math.max(0, 1 - distance / 60);
  if (near > 0.1) {
    const n = noiseSource(ctx, 'white');
    const hp = filt(ctx, 'highpass', 600, 0.5);
    const g = env(ctx, t, gain * near * 0.8, 0.002, 0.35);
    n.connect(hp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.5);
  }
  for (let i = 0; i < 4; i++) {
    const tt = t + 0.05 + i * (0.35 + Math.random() * 0.5);
    rumble(ctx, { t: tt, out, gain: gain * (0.9 - i * 0.15) }, 1.8 + Math.random() * 1.5, 140 + near * 200, 0.08);
  }
}

// ------------------------------------------------------------------ loops

export interface Loop {
  out: GainNode;
  stop: () => void;
}

/** Rain: two noise layers (hiss and patter) with slow swells, plus random drips. */
export function rainLoop(ctx: BaseAudioContext, dest: AudioNode): Loop {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const hiss = noiseSource(ctx, 'pink');
  const hp = filt(ctx, 'highpass', 900, 0.4);
  const lp = filt(ctx, 'lowpass', 7000, 0.4);
  const hg = ctx.createGain();
  hg.gain.value = 0.55;
  hiss.connect(hp).connect(lp).connect(hg).connect(out);
  const patter = noiseSource(ctx, 'white');
  const bp = filt(ctx, 'bandpass', 2500, 0.6);
  const pg = ctx.createGain();
  pg.gain.value = 0.18;
  patter.connect(bp).connect(pg).connect(out);
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.07;
  const sg = ctx.createGain();
  sg.gain.value = 0.15;
  swell.connect(sg).connect(hg.gain);
  hiss.start();
  patter.start();
  swell.start();
  let alive = true;
  const drip = () => {
    if (!alive) return;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 1400 + Math.random() * 1800;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.05);
    const g = env(ctx, t, 0.04 + Math.random() * 0.05, 0.001, 0.06);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.1);
    setTimeout(drip, 40 + Math.random() * 160);
  };
  drip();
  return {
    out,
    stop: () => {
      alive = false;
      for (const s of [hiss, patter, swell]) s.stop();
      out.disconnect();
    },
  };
}

/** Fire: a soft roar and random crackles. Braziers, burning ground, lava. */
export function fireLoop(ctx: BaseAudioContext, dest: AudioNode): Loop {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  const n = noiseSource(ctx, 'brown');
  const lp = filt(ctx, 'lowpass', 500, 0.5);
  n.connect(lp).connect(out);
  n.start();
  let alive = true;
  const crackle = () => {
    if (!alive) return;
    const t = ctx.currentTime + 0.01;
    const s = noiseSource(ctx, 'white');
    const bp = filt(ctx, 'bandpass', 1500 + Math.random() * 3500, 3);
    const g = env(ctx, t, 0.25 + Math.random() * 0.35, 0.001, 0.015 + Math.random() * 0.03);
    s.connect(bp).connect(g).connect(out);
    s.start(t);
    s.stop(t + 0.08);
    setTimeout(crackle, 30 + Math.random() * 220);
  };
  crackle();
  return {
    out,
    stop: () => {
      alive = false;
      n.stop();
      out.disconnect();
    },
  };
}
