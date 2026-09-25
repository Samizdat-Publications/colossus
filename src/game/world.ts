import * as THREE from 'three';
import LAYOUT from '../data/arena_layout.json';

export const ARENA = LAYOUT;

export interface Circle {
  x: number;
  z: number;
  r: number;
  h: number; // height (for camera and projectile tests)
}

export interface CapsuleXZ {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
  h: number;
}

/** Static and dynamic 2D colliders on the arena floor (XZ plane). */
export class World {
  readonly statics: Circle[] = [];
  readonly capsules: CapsuleXZ[] = [];
  /** Filled every frame by the golem (feet, planted fists, kneeling body). */
  readonly dynamic: Circle[] = [];

  constructor() {
    for (const p of LAYOUT.pillars) this.statics.push({ x: p.x, z: p.z, r: p.r, h: p.h });
    for (const r of LAYOUT.rubble) this.statics.push({ x: r.x, z: r.z, r: r.r, h: 1.6 });
    for (const b of LAYOUT.braziers) this.statics.push({ x: b.x, z: b.z, r: 0.9, h: 2.2 });
    for (const f of LAYOUT.fallen) {
      const yaw = (f.yaw * Math.PI) / 180;
      const dx = Math.sin(yaw) * f.length * 0.5;
      const dz = Math.cos(yaw) * f.length * 0.5;
      this.capsules.push({ ax: f.x - dx, az: f.z - dz, bx: f.x + dx, bz: f.z + dz, r: f.r, h: f.r * 2 });
    }
  }

  /** Push a circle of radius `r` at `pos` out of every collider and keep it inside `limit`. */
  resolve(pos: THREE.Vector3, r: number, limit = LAYOUT.playerLimit, includeDynamic = true): boolean {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.statics) if (pushOutCircle(pos, r, c)) hit = true;
      if (includeDynamic) for (const c of this.dynamic) if (pushOutCircle(pos, r, c)) hit = true;
      for (const c of this.capsules) if (pushOutCapsule(pos, r, c)) hit = true;
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > limit - r) {
      const k = (limit - r) / d;
      pos.x *= k;
      pos.z *= k;
      hit = true;
    }
    return hit;
  }

  /** Is the point (x, y, z) inside a static obstacle volume? Used by camera and projectiles. */
  blocked(x: number, y: number, z: number, pad = 0): boolean {
    for (const c of this.statics) {
      if (y > c.h + pad) continue;
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + pad) ** 2) return true;
    }
    for (const c of this.capsules) {
      if (y > c.h + pad) continue;
      if (distToSegXZ(x, z, c) < c.r + pad) return true;
    }
    return false;
  }
}

function pushOutCircle(pos: THREE.Vector3, r: number, c: Circle): boolean {
  const dx = pos.x - c.x;
  const dz = pos.z - c.z;
  const min = r + c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-5) {
    pos.x += min;
    return true;
  }
  const k = (min - d) / d;
  pos.x += dx * k;
  pos.z += dz * k;
  return true;
}

function distToSegXZ(x: number, z: number, c: CapsuleXZ): number {
  const vx = c.bx - c.ax;
  const vz = c.bz - c.az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? ((x - c.ax) * vx + (z - c.az) * vz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (c.ax + vx * t), z - (c.az + vz * t));
}

function pushOutCapsule(pos: THREE.Vector3, r: number, c: CapsuleXZ): boolean {
  const vx = c.bx - c.ax;
  const vz = c.bz - c.az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? ((pos.x - c.ax) * vx + (pos.z - c.az) * vz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = c.ax + vx * t;
  const cz = c.az + vz * t;
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const min = r + c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2) || 1e-5;
  const k = (min - d) / d;
  pos.x += dx * k;
  pos.z += dz * k;
  return true;
}
