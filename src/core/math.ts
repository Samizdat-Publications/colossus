import * as THREE from 'three';

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const remap01 = (a: number, b: number, v: number): number => clamp01(invLerp(a, b, v));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const wrapAngle = (a: number): number => {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
};
/** Signed shortest difference b - a. */
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);
export const dampAngle = (a: number, b: number, lambda: number, dt: number): number =>
  a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
export const rotateToward = (a: number, b: number, maxDelta: number): number => {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
};
export const moveToward = (a: number, b: number, maxDelta: number): number => {
  if (Math.abs(b - a) <= maxDelta) return b;
  return a + Math.sign(b - a) * maxDelta;
};

/** Yaw 0 faces +Z; positive yaw turns toward +X. */
export const yawToDir = (yaw: number, out: THREE.Vector3): THREE.Vector3 => out.set(Math.sin(yaw), 0, Math.cos(yaw));
export const dirToYaw = (x: number, z: number): number => Math.atan2(x, z);

export type EaseFn = (t: number) => number;
export const ease: Record<string, EaseFn> = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t) => -(Math.cos(PI * t) - 1) / 2,
  outSine: (t) => Math.sin((t * PI) / 2),
  inSine: (t) => 1 - Math.cos((t * PI) / 2),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
};
export type EaseName = keyof typeof ease;

/** Small deterministic RNG (mulberry32). */
export class RNG {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  seed(v: number): void {
    this.s = v >>> 0 || 1;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}
export const rng = new RNG((Date.now() & 0xffffff) + 17);

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

/** Closest point to p on segment ab. */
export function closestOnSegment(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  _ab.subVectors(b, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-9 ? clamp01(_ap.subVectors(p, a).dot(_ab) / len2) : 0;
  return out.copy(a).addScaledVector(_ab, t);
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Squared distance between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segSegDist2(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  outC1?: THREE.Vector3,
  outC2?: THREE.Vector3,
): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  if (outC1) outC1.copy(_c1);
  if (outC2) outC2.copy(_c2);
  return _c1.distanceToSquared(_c2);
}

export const v3 = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Horizontal (XZ) distance. */
export const distXZ = (a: THREE.Vector3, b: THREE.Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Deterministic 1D value noise in [-1, 1], smooth, for camera shake and flicker. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 101.7) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}
