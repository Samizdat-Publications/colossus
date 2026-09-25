import * as THREE from 'three';
import { bus } from '../core/events';
import { Music, type MusicMode } from './music';
import { chime, clank, crunch, env, fireLoop, noiseSource, rainLoop, roar, rumble, thud, thunder, whoosh, type Loop } from './synth';

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
}

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();

/**
 * All sound. Created on the first user gesture (browsers keep audio locked until then). Gameplay never
 * calls this directly: it listens to the event bus and to a few per-frame values.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  music: Music | null = null;
  private rain: Loop | null = null;
  private fire: Loop | null = null;
  private readonly camera: THREE.Camera;
  private readonly listener = new THREE.Vector3();
  private lastPlayed = new Map<string, number>();
  settings: AudioSettings = { master: 0.8, music: 0.55, sfx: 0.9 };
  private unsub: (() => void)[] = [];
  private analyser: AnalyserNode | null = null;
  private readonly levelBuf = new Float32Array(1024);

  /** RMS level of everything that is playing (tests use it to check that sound is really produced). */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    return Math.sqrt(sum / this.levelBuf.length);
  }

  constructor(camera: THREE.Camera, private readonly enabled: boolean) {
    this.camera = camera;
  }

  /** Call from a user gesture (click / key). Safe to call repeatedly. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;
      this.master = ctx.createGain();
      this.master.connect(comp).connect(ctx.destination);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      comp.connect(this.analyser);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.amb = ctx.createGain();
      this.amb.connect(this.master);
      this.music = new Music(ctx, this.master);
      this.rain = rainLoop(ctx, this.amb);
      this.fire = fireLoop(ctx, this.amb);
      this.applySettings();
      this.hook();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applySettings(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.amb.gain.setTargetAtTime(this.settings.sfx * 0.9, t, 0.05);
    this.music?.out.gain.setTargetAtTime(this.settings.music * 0.9, t, 0.05);
  }

  setMusic(mode: MusicMode, phase = 1): void {
    this.music?.setMode(mode, phase);
  }

  /**
   * Per frame: where the listener is (the warrior), how loud the rain and the nearest fire are, how hot
   * the fight is (the drums drop while the golem is down).
   */
  update(listener: THREE.Vector3, rain: number, fire: number, heat: number, phase: number): void {
    if (!this.ctx) return;
    this.listener.copy(listener);
    const t = this.ctx.currentTime;
    this.rain?.out.gain.setTargetAtTime(0.32 * rain, t, 0.3);
    this.fire?.out.gain.setTargetAtTime(0.55 * fire, t, 0.2);
    if (this.music) {
      this.music.heat += (heat - this.music.heat) * 0.05;
      this.music.setPhase(phase);
    }
  }

  // ------------------------------------------------------------------ voices

  /** A one-shot's output node, panned and attenuated for a world position. */
  private voice(pos: THREE.Vector3 | null, gain: number, ref = 6): { t: number; out: AudioNode; gain: number } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const t = ctx.currentTime + 0.005;
    if (!pos) return { t, out: this.sfx, gain };
    const d = pos.distanceTo(this.listener);
    const att = ref / (ref + Math.max(0, d - ref));
    const pan = ctx.createStereoPanner();
    _d.subVectors(pos, this.camera.position).setY(0);
    const len = _d.length();
    if (len > 0.5) {
      _r.set(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
      pan.pan.value = THREE.MathUtils.clamp(_d.dot(_r) / len, -1, 1) * 0.75;
    }
    pan.connect(this.sfx);
    const node = ctx.createGain();
    node.gain.value = att;
    node.connect(pan);
    window.setTimeout(() => {
      node.disconnect();
      pan.disconnect();
    }, 8000);
    return { t, out: node, gain };
  }

  /** Throttle: at most one of `key` every `gap` seconds. */
  private ok(key: string, gap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(key) ?? -99;
    if (now - last < gap) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private hook(): void {
    const on = bus.on.bind(bus);
    const ctx = () => this.ctx!;
    const u = this.unsub;
    // ---- warrior
    u.push(on('swing', (e) => {
      const v = this.voice(e.pos, e.heavy ? 0.34 : 0.24, 4);
      if (!v) return;
      if (e.heavy) whoosh(ctx(), v, e.charged ? 0.5 : 0.4, 1500, 420, 1.4);
      else whoosh(ctx(), v, 0.22, 2600, 900, 1.6);
      if (e.charged) clank(ctx(), { ...v, gain: 0.08 }, 1320, 0.4, 0.5);
    }));
    u.push(on('roll', (e) => {
      const v = this.voice(e.pos, 0.22, 4);
      if (!v) return;
      whoosh(ctx(), v, 0.34, 900, 260, 0.9);
      crunch(ctx(), { ...v, gain: 0.08 }, 0.3, 2400, 4);
    }));
    u.push(on('jump', (e) => {
      const v = this.voice(e.pos, 0.14, 4);
      if (v) whoosh(ctx(), v, 0.25, 700, 1400, 1.2);
    }));
    u.push(on('land', (e) => {
      const v = this.voice(e.pos, e.hard ? 0.4 : 0.22, 4);
      if (!v) return;
      thud(ctx(), v, 140, 60, 0.18, 0.5);
      this.splash(v, 0.12);
    }));
    u.push(on('footstep', (e) => {
      if (!this.ok('step', 0.12)) return;
      const v = this.voice(e.pos, e.run ? 0.11 : 0.07, 4);
      if (!v) return;
      thud(ctx(), v, 190, 90, 0.07, 0.4);
      this.splash(v, 0.1);
    }));
    u.push(on('playerHit', (e) => {
      const v = this.voice(e.pos, 0.55, 5);
      if (!v) return;
      thud(ctx(), v, 110, 40, 0.35, 0.8);
      clank(ctx(), { ...v, gain: 0.18 }, 190, 0.35, 0.6);
      crunch(ctx(), { ...v, gain: 0.2 }, 0.2, 700, 6);
    }));
    u.push(on('playerBlock', (e) => {
      const v = this.voice(e.pos, 0.35, 5);
      if (!v) return;
      clank(ctx(), v, 410, 0.55, 1);
      thud(ctx(), { ...v, gain: 0.25 }, 160, 70, 0.15, 0.3);
    }));
    u.push(on('justGuard', (e) => {
      const v = this.voice(e.pos, 0.35, 5);
      if (v) clank(ctx(), v, 880, 0.9, 1);
    }));
    u.push(on('guardBreak', (e) => {
      const v = this.voice(e.pos, 0.4, 5);
      if (!v) return;
      clank(ctx(), v, 300, 0.4, 0.6);
      crunch(ctx(), { ...v, gain: 0.25 }, 0.25, 900, 8);
    }));
    u.push(on('hazardBurn', (e) => {
      if (!this.ok('burn', 0.3)) return;
      const v = this.voice(e.pos, 0.18, 4);
      if (v) whoosh(ctx(), v, 0.25, 5200, 3000, 0.8, 'white');
    }));
    u.push(on('healStart', (e) => {
      const v = this.voice(e.pos, 0.2, 4);
      if (!v) return;
      for (let i = 0; i < 3; i++) this.blip({ ...v, t: v.t + 0.15 + i * 0.18 }, 320 - i * 40, 0.08);
    }));
    u.push(on('heal', (e) => {
      const v = this.voice(e.pos, 0.18, 4);
      if (v) chime(ctx(), v, 659, 1.4);
    }));
    u.push(on('healEmpty', () => {
      const v = this.voice(null, 0.12);
      if (v) this.blip(v, 140, 0.12);
    }));
    u.push(on('noStamina', () => {
      if (!this.ok('nostam', 0.4)) return;
      const v = this.voice(null, 0.08);
      if (v) this.blip(v, 110, 0.15);
    }));
    u.push(on('playerDeath', (e) => {
      const v = this.voice(e.pos, 0.6, 5);
      if (v) thud(ctx(), v, 90, 30, 0.8, 0.8);
      this.setMusic('death');
    }));
    u.push(on('lockOn', (e) => {
      const v = this.voice(null, 0.06);
      if (v) this.blip(v, e.on ? 1180 : 820, 0.05);
    }));
    // ---- combat results
    u.push(on('coreHit', (e) => {
      const v = this.voice(e.pos, e.crit ? 0.5 : 0.36, 8);
      if (!v) return;
      const f = e.core === 'core_back' ? 523 : e.core === 'core_chest' ? 392 : 740;
      chime(ctx(), v, f, e.crit ? 2.0 : 1.1);
      crunch(ctx(), { ...v, gain: v.gain * 0.6 }, 0.18, 3200, 6);
      thud(ctx(), { ...v, gain: v.gain * 0.5 }, 160, 70, 0.2, 0.4);
      if (e.crit) chime(ctx(), { ...v, t: v.t + 0.06, gain: v.gain * 0.6 }, f * 1.5, 2.2);
    }));
    u.push(on('bodyHit', (e) => {
      const v = this.voice(e.pos, 0.3, 8);
      if (!v) return;
      thud(ctx(), v, 130, 55, 0.22, 0.6);
      crunch(ctx(), { ...v, gain: 0.2 }, 0.2, 1100, 6);
    }));
    u.push(on('deflect', (e) => {
      const v = this.voice(e.pos, e.heavy ? 0.4 : 0.3, 8);
      if (!v) return;
      clank(ctx(), v, e.heavy ? 210 : 260, 0.35, 0.7);
      crunch(ctx(), { ...v, gain: 0.25 }, 0.12, 1300, 5);
    }));
    // ---- golem
    u.push(on('golemStep', (e) => {
      const v = this.voice(e.pos, 0.42 * e.strength, 14);
      if (!v) return;
      thud(ctx(), v, 58, 28, 0.55, 0.8);
      crunch(ctx(), { ...v, gain: v.gain * 0.35 }, 0.3, 380, 8);
      this.splash(v, 0.25);
    }));
    u.push(on('golemWindup', (e) => {
      if (!this.ok('windup', 0.6)) return;
      const v = this.voice(e.pos, 0.2, 16);
      if (!v) return;
      crunch(ctx(), v, Math.min(1.2, e.duration), 320, 14);
      if (e.attack !== 'meteor') roar(ctx(), { ...v, gain: 0.16 }, Math.min(1.1, e.duration), 42);
    }));
    u.push(on('slamImpact', (e) => {
      const v = this.voice(e.pos, e.big ? 1.0 : 0.85, 18);
      if (!v) return;
      thud(ctx(), v, 72, 26, 1.1, 1.0);
      rumble(ctx(), { ...v, gain: v.gain * 0.8 }, 2.4, 140);
      crunch(ctx(), { ...v, gain: v.gain * 0.5 }, 0.8, 600, 20);
      this.splash({ ...v, gain: v.gain * 0.6 }, 0.4);
    }));
    u.push(on('stompImpact', (e) => {
      const v = this.voice(e.pos, 0.85, 18);
      if (!v) return;
      thud(ctx(), v, 62, 24, 0.9, 1.0);
      rumble(ctx(), { ...v, gain: 0.6 }, 1.8, 120);
    }));
    u.push(on('shockwave', (e) => {
      const v = this.voice(e.pos, 0.4, 20);
      if (v) whoosh(ctx(), v, 1.1, 320, 70, 0.7);
    }));
    u.push(on('sweepWhoosh', (e) => {
      const v = this.voice(e.pos, 0.6, 18);
      if (!v) return;
      whoosh(ctx(), v, 0.9, 200, 55, 0.8);
      crunch(ctx(), { ...v, gain: 0.2 }, 0.8, 300, 10);
    }));
    u.push(on('rockGrab', (e) => {
      const v = this.voice(e.pos, 0.3, 16);
      if (v) crunch(ctx(), v, 0.6, 350, 12);
    }));
    u.push(on('rockThrow', (e) => {
      const v = this.voice(e.pos, 0.45, 16);
      if (v) whoosh(ctx(), v, 1.0, 420, 110, 0.9);
    }));
    u.push(on('rockImpact', (e) => {
      if (!this.ok('rockImpact', 0.05)) return;
      const v = this.voice(e.pos, 0.7, 14);
      if (!v) return;
      thud(ctx(), v, 85, 32, 0.7, 0.9);
      crunch(ctx(), { ...v, gain: 0.4 }, 0.45, 700, 14);
      rumble(ctx(), { ...v, gain: 0.35 }, 1.0, 160);
    }));
    u.push(on('fissure', (e) => {
      const v = this.voice(e.pos, 0.55, 16);
      if (!v) return;
      rumble(ctx(), v, 1.3, 220);
      crunch(ctx(), { ...v, gain: 0.35 }, 1.1, 500, 18);
    }));
    u.push(on('meteorWarn', (e) => {
      if (!this.ok('meteor', 0.15)) return;
      const v = this.voice(e.pos, 0.16, 14);
      if (!v) return;
      const o = ctx().createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(1900, v.t);
      o.frequency.exponentialRampToValueAtTime(380, v.t + 1.3);
      const g = env(ctx(), v.t, v.gain, 0.2, 1.1, 'lin');
      o.connect(g).connect(v.out);
      o.start(v.t);
      o.stop(v.t + 1.5);
    }));
    u.push(on('leapTakeoff', (e) => {
      const v = this.voice(e.pos, 0.7, 18);
      if (!v) return;
      thud(ctx(), v, 70, 30, 0.6, 0.8);
      whoosh(ctx(), { ...v, gain: 0.45 }, 1.2, 240, 90, 0.8);
    }));
    u.push(on('roar', (e) => {
      const v = this.voice(e.pos, 0.95, 24);
      if (!v) return;
      roar(ctx(), v, e.phase >= 4 ? 2.0 : 2.6, 54 - Math.min(3, e.phase) * 3);
      rumble(ctx(), { ...v, gain: 0.35 }, 2.5, 90, 0.4);
    }));
    u.push(on('pushWave', (e) => {
      const v = this.voice(e.pos, 0.5, 20);
      if (!v) return;
      whoosh(ctx(), v, 0.9, 260, 60, 0.7);
      rumble(ctx(), { ...v, gain: 0.4 }, 1.2, 100);
    }));
    u.push(on('staggerStart', (e) => {
      const v = this.voice(e.pos, 0.9, 20);
      if (!v) return;
      thud(ctx(), v, 60, 24, 1.2, 1.0);
      crunch(ctx(), { ...v, gain: 0.5 }, 1.0, 450, 26);
      rumble(ctx(), { ...v, gain: 0.6 }, 2.5, 110);
      chime(ctx(), { ...this.voice(null, 0.22)!, t: v.t + 0.25 }, 988, 2.5);
    }));
    u.push(on('staggerEnd', (e) => {
      const v = this.voice(e.pos, 0.4, 20);
      if (v) crunch(ctx(), v, 1.0, 320, 16);
    }));
    u.push(on('phaseChange', (e) => {
      const v = this.voice(null, 0.5);
      if (v) rumble(ctx(), v, 3.0, 80, 0.5);
      this.music?.setPhase(e.phase);
    }));
    u.push(on('golemDeath', (e) => {
      const v = this.voice(e.pos, 1.0, 24);
      if (!v) return;
      roar(ctx(), { ...v, gain: 0.7 }, 3.2, 40);
      rumble(ctx(), v, 5.0, 120, 0.3);
      for (let i = 0; i < 6; i++) crunch(ctx(), { ...v, t: v.t + 0.8 + i * 0.45, gain: 0.45 }, 0.6, 400 + i * 60, 14);
    }));
    u.push(on('assembleStart', (e) => {
      const v = this.voice(null, e.quick ? 0.3 : 0.45);
      if (v) rumble(ctx(), v, e.quick ? 2.0 : 6.0, 110, 1.0);
    }));
    u.push(on('assembleChunk', (e) => {
      if (!this.ok('chunk', 0.07)) return;
      const v = this.voice(e.pos, 0.25 * Math.min(1.5, e.size), 16);
      if (!v) return;
      thud(ctx(), v, 110, 45, 0.3, 0.6);
      crunch(ctx(), { ...v, gain: 0.15 }, 0.2, 600, 5);
    }));
    u.push(on('fightStart', () => this.setMusic('fight', 1)));
    u.push(on('victory', () => this.setMusic('victory')));
    u.push(on('lightning', (e) => {
      const v = this.voice(null, 0.7 * e.strength);
      if (!v) return;
      thunder(ctx(), { ...v, t: v.t + e.distance / 340 }, e.distance);
    }));
  }

  /** Water: a short high hiss. Rain is falling on everything. */
  private splash(v: { t: number; out: AudioNode; gain: number }, amt: number): void {
    const ctx = this.ctx!;
    const n = noiseSource(ctx, 'white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const g = env(ctx, v.t, v.gain * amt * 2, 0.002, 0.12);
    n.connect(hp).connect(g).connect(v.out);
    n.start(v.t);
    n.stop(v.t + 0.2);
  }

  private blip(v: { t: number; out: AudioNode; gain: number }, f: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, v.t);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, v.t + dur);
    const g = env(ctx, v.t, v.gain, 0.003, dur);
    o.connect(g).connect(v.out);
    o.start(v.t);
    o.stop(v.t + dur + 0.05);
  }

  /** UI feedback for menus. */
  uiClick(): void {
    const v = this.voice(null, 0.08);
    if (v) this.blip(v, 660, 0.06);
  }

  dispose(): void {
    for (const f of this.unsub) f();
    this.unsub = [];
    this.rain?.stop();
    this.fire?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
