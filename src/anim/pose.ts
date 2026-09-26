import * as THREE from 'three';
import { DEG, ease, type EaseName } from '../core/math';
import type { Rig } from './rig';

export type Euler3 = [number, number, number];

/**
 * Pose authoring format. Keys are bone names with [x, y, z] rotations in degrees, applied in
 * 'YXZ' order in the bone's rest frame (X = character left, Y = up, Z = forward):
 *   x > 0 : a limb hanging down swings BACK; the spine/neck bends FORWARD
 *   y > 0 : turns toward the character's left (applied last, around the parent's vertical)
 *   z > 0 : a hanging limb swings toward the character's left (+X)
 * `$pos` offsets the whole body (metres, character space), `$rot` rotates it (degrees).
 */
export type PoseDef = { [bone: string]: Euler3 | undefined };

const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Pose {
  readonly q: THREE.Quaternion[];
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Quaternion();

  constructor(readonly n: number) {
    this.q = [];
    for (let i = 0; i < n; i++) this.q.push(new THREE.Quaternion());
  }

  identity(): this {
    for (const q of this.q) q.identity();
    this.pos.set(0, 0, 0);
    this.rot.identity();
    return this;
  }

  copy(p: Pose): this {
    for (let i = 0; i < this.n; i++) this.q[i].copy(p.q[i]);
    this.pos.copy(p.pos);
    this.rot.copy(p.rot);
    return this;
  }

  clone(): Pose {
    return new Pose(this.n).copy(this);
  }

  /** this = slerp(a, b, t) */
  blend(a: Pose, b: Pose, t: number): this {
    if (t <= 0) return this.copy(a);
    if (t >= 1) return this.copy(b);
    for (let i = 0; i < this.n; i++) this.q[i].slerpQuaternions(a.q[i], b.q[i], t);
    this.pos.lerpVectors(a.pos, b.pos, t);
    this.rot.slerpQuaternions(a.rot, b.rot, t);
    return this;
  }

  /** Apply a PoseDef on top of identity (or on top of the current pose when additive). */
  set(def: PoseDef, rig: Rig, additive = false): this {
    if (!additive) this.identity();
    for (const key of Object.keys(def)) {
      const v = def[key];
      if (!v) continue;
      if (key === '$pos') {
        if (additive) this.pos.add(new THREE.Vector3(v[0], v[1], v[2]));
        else this.pos.set(v[0], v[1], v[2]);
        continue;
      }
      _e.set(v[0] * DEG, v[1] * DEG, v[2] * DEG, 'YXZ');
      if (key === '$rot') {
        if (additive) this.rot.multiply(new THREE.Quaternion().setFromEuler(_e));
        else this.rot.setFromEuler(_e);
        continue;
      }
      const i = rig.index.get(key);
      if (i === undefined) continue;
      if (additive) this.q[i].multiply(new THREE.Quaternion().setFromEuler(_e));
      else this.q[i].setFromEuler(_e);
    }
    return this;
  }

  /** Rotate bone i by euler degrees on top of its current value. */
  addEuler(i: number, x: number, y: number, z: number): this {
    _e.set(x * DEG, y * DEG, z * DEG, 'YXZ');
    this.q[i].multiply(_q.setFromEuler(_e));
    return this;
  }

  setEuler(i: number, x: number, y: number, z: number): this {
    _e.set(x * DEG, y * DEG, z * DEG, 'YXZ');
    this.q[i].setFromEuler(_e);
    return this;
  }

  applyTo(rig: Rig): void {
    for (let i = 0; i < this.n; i++) rig.bones[i].quaternion.copy(this.q[i]);
    rig.offset.position.copy(this.pos);
    rig.offset.quaternion.copy(this.rot);
  }

  static from(def: PoseDef, rig: Rig): Pose {
    return new Pose(rig.count).set(def, rig);
  }
}
const _q = new THREE.Quaternion();

/** Merge pose defs left to right (later keys win). Handy for mirroring and variants. */
export function mergeDefs(...defs: PoseDef[]): PoseDef {
  return Object.assign({}, ...defs);
}

/** Mirror a pose def left/right (swap _L/_R bones, negate y and z rotations and x position). */
export function mirrorDef(def: PoseDef): PoseDef {
  const out: PoseDef = {};
  for (const key of Object.keys(def)) {
    const v = def[key];
    if (!v) continue;
    let k = key;
    if (key.endsWith('_L')) k = key.slice(0, -2) + '_R';
    else if (key.endsWith('_R')) k = key.slice(0, -2) + '_L';
    if (key === '$pos') out[k] = [-v[0], v[1], v[2]];
    else out[k] = [v[0], -v[1], -v[2]];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

export type PoseTarget = Pose | ((out: Pose, t: number, dt: number) => void);

export interface Step {
  name: string;
  dur: number;
  /** Target pose reached at the end of the step (interpolated from the pose at step start). */
  pose?: PoseTarget;
  ease?: EaseName;
  /**
   * Procedural poses only: blend in from the previous pose over this many seconds, then follow the pose
   * function exactly. (The default blend weight grows with progress, so a pose function that drives a full
   * somersault was only partly applied, and past 180 degrees the rotation took the short way, backwards.)
   */
  blendIn?: number;
  enter?: () => void;
  /** t = normalized progress in the step. */
  update?: (t: number, dt: number) => void;
  exit?: () => void;
}

/** A timed chain of pose steps. Each step blends from the previous step's end pose. */
export class Sequence {
  index = 0;
  time = 0;
  done = false;
  readonly from: Pose;
  readonly current: Pose;
  private readonly target: Pose;
  private entered = false;

  constructor(
    readonly steps: Step[],
    start: Pose,
  ) {
    this.from = start.clone();
    this.current = start.clone();
    this.target = start.clone();
  }

  get step(): Step | undefined {
    return this.steps[this.index];
  }
  get stepName(): string {
    return this.step?.name ?? '';
  }
  get progress(): number {
    const s = this.step;
    return s && s.dur > 0 ? Math.min(1, this.time / s.dur) : 1;
  }
  /** Seconds left in the current step. */
  get remaining(): number {
    const s = this.step;
    return s ? Math.max(0, s.dur - this.time) : 0;
  }
  /** Seconds until the start of the step with this name (0 if current or past, -1 if absent). */
  timeUntil(name: string): number {
    let acc = this.remaining;
    for (let k = this.index + 1; k < this.steps.length; k++) {
      if (this.steps[k].name === name) return acc;
      acc += this.steps[k].dur;
    }
    return this.steps[this.index]?.name === name ? 0 : -1;
  }

  private evalTarget(step: Step, t: number, dt: number): void {
    const p = step.pose;
    if (!p) this.target.copy(this.from);
    else if (p instanceof Pose) this.target.copy(p);
    else p(this.target, t, dt);
  }

  update(dt: number): void {
    let remaining = dt;
    let guard = 0;
    while (!this.done && guard++ < 32) {
      const step = this.steps[this.index];
      if (!step) {
        this.done = true;
        break;
      }
      if (!this.entered) {
        this.entered = true;
        step.enter?.();
      }
      const left = step.dur - this.time;
      const use = Math.min(remaining, Math.max(0, left));
      this.time += use;
      remaining -= use;
      const t = step.dur > 0 ? Math.min(1, this.time / step.dur) : 1;
      this.evalTarget(step, t, use);
      const e = step.blendIn !== undefined ? Math.min(1, step.blendIn > 0 ? this.time / step.blendIn : 1) : ease[step.ease ?? 'inOutSine'](t);
      if (e >= 1) this.current.copy(this.target);
      else this.current.blend(this.from, this.target, e);
      step.update?.(t, use);
      if (this.time >= step.dur - 1e-6) {
        step.exit?.();
        this.from.copy(this.current);
        this.index++;
        this.time = 0;
        this.entered = false;
        if (this.index >= this.steps.length) {
          this.done = true;
          break;
        }
        if (remaining <= 1e-9) {
          // Enter the next step now so its enter() fires on the boundary frame.
          const next = this.steps[this.index];
          this.entered = true;
          next.enter?.();
          break;
        }
      } else break;
    }
  }

  /** Abort: jump to done without calling remaining exits. */
  cancel(): void {
    this.done = true;
  }

  /** End the current step early (its target pose is reached at the pose blended so far). */
  skipStep(): void {
    const s = this.step;
    if (!s) return;
    s.exit?.();
    this.from.copy(this.current);
    this.index++;
    this.time = 0;
    this.entered = false;
    if (this.index >= this.steps.length) this.done = true;
  }

  /** Jump to the named step (exits the current one). */
  jumpTo(name: string): void {
    const k = this.steps.findIndex((s, i) => i > this.index && s.name === name);
    if (k < 0) return;
    this.step?.exit?.();
    this.from.copy(this.current);
    this.index = k;
    this.time = 0;
    this.entered = false;
  }
}

/**
 * Two layers: a base pose provided every frame (idle/locomotion) and an optional action sequence.
 * When a sequence finishes, the output crossfades back to the base pose.
 */
export class Animator {
  readonly out: Pose;
  readonly base: Pose;
  private readonly fadeFrom: Pose;
  private fadeT = 1;
  private fadeDur = 0.3;
  seq: Sequence | null = null;

  constructor(readonly rig: Rig) {
    this.out = new Pose(rig.count);
    this.base = new Pose(rig.count);
    this.fadeFrom = new Pose(rig.count);
  }

  play(steps: Step[]): Sequence {
    this.seq = new Sequence(steps, this.out);
    return this.seq;
  }

  stop(fade = 0.3): void {
    if (this.seq) {
      this.fadeFrom.copy(this.out);
      this.fadeT = 0;
      this.fadeDur = Math.max(1e-3, fade);
    }
    this.seq = null;
  }

  get busy(): boolean {
    return !!this.seq && !this.seq.done;
  }

  /** Advance. `baseFn` fills this.base with the locomotion pose. */
  update(dt: number, baseFn: (out: Pose) => void): void {
    baseFn(this.base);
    if (this.seq) {
      this.seq.update(dt);
      this.out.copy(this.seq.current);
      if (this.seq.done) {
        this.fadeFrom.copy(this.out);
        this.fadeT = 0;
        this.fadeDur = 0.3;
        this.seq = null;
      }
    } else if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / this.fadeDur);
      this.out.blend(this.fadeFrom, this.base, ease.inOutSine(this.fadeT));
    } else {
      this.out.copy(this.base);
    }
    this.out.applyTo(this.rig);
  }
}
