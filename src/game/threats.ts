import * as THREE from 'three';
import { balance } from '../core/balance';
import { bus } from '../core/events';
import { rng } from '../core/math';
import type { FightContext } from './context';
import { PLAYER_RADIUS } from './player';

export type HazardKind = 'crack' | 'lava';

export interface Hazard {
  pos: THREE.Vector3;
  radius: number;
  t: number;
  /** Seconds before the cracks start burning (the golem's fist is still in them). */
  arm: number;
  dur: number;
  dps: number;
  kind: HazardKind;
  seed: number;
}

export interface Wave {
  center: THREE.Vector3;
  r: number;
  speed: number;
  maxR: number;
  width: number;
  height: number;
  damage: number;
  source: string;
  hit: boolean;
}

export interface Rock {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  flight: number;
  target: THREE.Vector3;
  damage: number;
  radius: number;
  knockdown: boolean;
  knockback: number;
  size: number;
  spin: THREE.Vector3;
  tele: TelegraphHandle | null;
  hit: boolean;
  meteor: boolean;
  seed: number;
}

export interface Fissure {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  /** metres from `from` where eruptions begin (outside the slam's own radius) */
  start: number;
  /** seconds the crack line glows before the first eruption */
  delay: number;
  t: number;
  length: number;
  speed: number;
  damage: number;
  radius: number;
  hazardDur: number;
  kind: HazardKind;
  dist: number;
  erupted: number;
  hit: boolean;
}

export interface Telegraph {
  pos: THREE.Vector3;
  radius: number;
  t: number;
  dur: number;
  kind: string;
  dead: boolean;
  /** Sector telegraphs (sweeps): inner radius and angle range (world yaw, radians). */
  inner?: number;
  a0?: number;
  a1?: number;
}

export interface TelegraphHandle {
  set: (p: THREE.Vector3) => void;
  kill: () => void;
}

export interface Spike {
  pos: THREE.Vector3;
  t: number;
  size: number;
  kind: HazardKind;
}

const GRAVITY = 22;
const FISSURE_SPACING = 1.6;

/**
 * Gameplay state of everything the golem leaves in the arena. Visuals live in a separate view
 * (see render/threatView.ts) that reads these arrays every frame.
 */
export class Threats {
  readonly hazards: Hazard[] = [];
  readonly waves: Wave[] = [];
  readonly rocks: Rock[] = [];
  readonly fissures: Fissure[] = [];
  readonly telegraphs: Telegraph[] = [];
  readonly spikes: Spike[] = [];
  private burnTick = 0;

  clear(): void {
    this.hazards.length = 0;
    this.waves.length = 0;
    this.rocks.length = 0;
    this.fissures.length = 0;
    this.telegraphs.length = 0;
    this.spikes.length = 0;
  }

  /** Burning cracks. `arm` = delay before they burn; `dur` counts from when they start burning. */
  hazard(pos: THREE.Vector3, radius: number, dur: number, dps: number, kind: HazardKind, arm = 0.5): void {
    if (dur <= 0) return;
    const max = balance.golem.hazards.maxActive;
    while (this.hazards.length >= max) this.hazards.shift();
    this.hazards.push({ pos: pos.clone().setY(0), radius, t: 0, arm, dur: dur + arm, dps, kind, seed: rng.next() * 1000 });
  }

  shockwave(center: THREE.Vector3, speed: number, maxR: number, width: number, height: number, damage: number, source: string): void {
    this.waves.push({ center: center.clone().setY(0), r: 1.5, speed, maxR, width, height, damage, source, hit: false });
    bus.emit('shockwave', { pos: center.clone(), maxRadius: maxR });
  }

  /** A red arc on the floor: the area a sweep will cross (yaw a0 -> a1 around pos). */
  sector(pos: THREE.Vector3, inner: number, outer: number, a0: number, a1: number, dur: number): TelegraphHandle {
    const t: Telegraph = { pos: pos.clone().setY(0), radius: outer, inner, a0, a1, t: 0, dur: Math.max(0.05, dur), kind: 'sector', dead: false };
    this.telegraphs.push(t);
    return {
      set: (p) => t.pos.set(p.x, 0, p.z),
      kill: () => (t.dead = true),
    };
  }

  telegraph(pos: THREE.Vector3, radius: number, dur: number, kind: string): TelegraphHandle {
    const t: Telegraph = { pos: pos.clone().setY(0), radius, t: 0, dur: Math.max(0.05, dur), kind, dead: false };
    this.telegraphs.push(t);
    return {
      set: (p) => t.pos.set(p.x, 0, p.z),
      kill: () => (t.dead = true),
    };
  }

  rock(from: THREE.Vector3, to: THREE.Vector3, flight: number, damage: number, radius: number, knockdown: boolean, knockback: number, size: number): void {
    const vel = new THREE.Vector3(
      (to.x - from.x) / flight,
      (to.y - from.y) / flight + 0.5 * GRAVITY * flight,
      (to.z - from.z) / flight,
    );
    const tele = this.telegraph(to, radius, flight, 'rock');
    this.rocks.push({
      pos: from.clone(),
      vel,
      t: 0,
      flight,
      target: to.clone(),
      damage,
      radius,
      knockdown,
      knockback,
      size,
      spin: new THREE.Vector3(rng.range(-4, 4), rng.range(-4, 4), rng.range(-4, 4)),
      tele,
      hit: false,
      meteor: false,
      seed: rng.next() * 1000,
    });
  }

  meteor(pos: THREE.Vector3, warn: number, damage: number, radius: number, knockback: number, from?: THREE.Vector3): void {
    const fall = 0.75;
    const tele = this.telegraph(pos, radius, warn, 'meteor');
    // come in at a steep slant from beside the line of sight, so trails read as falling from the sky
    const side = from ? new THREE.Vector3(pos.z - from.z, 0, from.x - pos.x).normalize().multiplyScalar(rng.sign() * 14) : new THREE.Vector3(rng.range(-8, 8), 0, rng.range(-8, 8));
    const start = pos.clone().add(side).add(new THREE.Vector3(0, 34, 0));
    const r: Rock = {
      pos: start,
      vel: new THREE.Vector3(),
      t: -(warn - fall),
      flight: fall,
      target: pos.clone().setY(0),
      damage,
      radius,
      knockdown: false,
      knockback,
      size: 1.4,
      spin: new THREE.Vector3(rng.range(-5, 5), rng.range(-5, 5), rng.range(-5, 5)),
      tele,
      hit: false,
      meteor: true,
      seed: rng.next() * 1000,
    };
    r.vel.set((r.target.x - start.x) / fall, (0 - start.y) / fall + 0.5 * GRAVITY * fall, (r.target.z - start.z) / fall);
    this.rocks.push(r);
    bus.emit('meteorWarn', { pos });
  }

  fissure(from: THREE.Vector3, dir: THREE.Vector3, length: number, speed: number, damage: number, radius: number, hazardDur: number, kind: HazardKind, start = 4, delay = 0.5): void {
    this.fissures.push({ from: from.clone().setY(0), dir: dir.clone().setY(0).normalize(), start, delay, t: 0, length, speed, damage, radius, hazardDur, kind, dist: 0, erupted: 0, hit: false });
  }

  update(dt: number, ctx: FightContext): void {
    const pl = ctx.player;
    // hazards
    this.burnTick -= dt;
    let burning = false;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      if (h.t >= h.dur) {
        this.hazards.splice(i, 1);
        continue;
      }
      if (h.t < h.arm || !ctx.live) continue; // not burning yet
      const d = Math.hypot(pl.pos.x - h.pos.x, pl.pos.z - h.pos.z);
      const fade = h.t > h.dur - 1 ? h.dur - h.t : 1;
      if (d < h.radius * 0.92 && fade > 0.3) {
        if (pl.burn(h.dps * dt)) burning = true;
      }
    }
    if (burning && this.burnTick <= 0) {
      this.burnTick = 0.35;
      bus.emit('hazardBurn', { pos: pl.pos });
    }

    // shockwave rings
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.speed * dt;
      if (w.r > w.maxR) {
        this.waves.splice(i, 1);
        continue;
      }
      if (w.hit || !pl.alive || !ctx.live) continue;
      const d = Math.hypot(pl.pos.x - w.center.x, pl.pos.z - w.center.z);
      if (Math.abs(d - w.r) < w.width * 0.5 + PLAYER_RADIUS) {
        if (pl.feetHeight >= w.height * 0.55) continue; // jumped over it
        const res = pl.takeHit({ damage: w.damage, from: w.center, knockdown: true, knockback: 7, unblockable: true, source: w.source });
        w.hit = true;
        if (res === 'dodged') bus.emit('tip', { id: 'dodged-wave', text: '' });
      }
    }

    // rocks and meteors
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.t += dt;
      if (r.t < 0) continue; // meteor still up in the clouds
      r.vel.y -= GRAVITY * dt;
      r.pos.addScaledVector(r.vel, dt);
      let impact = r.t >= r.flight || r.pos.y <= 0;
      // direct hit on the player in flight
      if (!r.hit && !impact && pl.alive && ctx.live) {
        const dx = pl.pos.x - r.pos.x;
        const dz = pl.pos.z - r.pos.z;
        const dy = pl.y + 0.9 - r.pos.y;
        if (dx * dx + dz * dz + dy * dy * 0.5 < (r.size + PLAYER_RADIUS + 0.2) ** 2) impact = true;
      }
      // pillars and walls stop rocks
      if (!impact && !r.meteor && ctx.world.blocked(r.pos.x, r.pos.y, r.pos.z, r.size * 0.6)) impact = true;
      if (!impact) continue;
      r.tele?.kill();
      const center = r.pos.clone();
      center.y = Math.max(0, center.y);
      bus.emit('rockImpact', { pos: center.clone(), radius: r.radius });
      if (pl.alive && ctx.live) {
        const d = Math.hypot(pl.pos.x - center.x, pl.pos.z - center.z);
        if (d < r.radius + PLAYER_RADIUS && pl.y < center.y + 2.2) {
          pl.takeHit({ damage: r.damage, from: center, knockdown: r.knockdown, knockback: r.knockback, source: r.meteor ? 'meteor' : 'rock' });
        }
      }
      this.rocks.splice(i, 1);
    }

    // fissures: eruptions racing along a line
    for (let i = this.fissures.length - 1; i >= 0; i--) {
      const f = this.fissures[i];
      f.t += dt;
      if (f.t < f.delay) continue; // the crack line glows first
      f.dist += f.speed * dt;
      while (f.erupted * FISSURE_SPACING <= Math.min(f.dist, f.length)) {
        const p = f.from.clone().addScaledVector(f.dir, f.erupted * FISSURE_SPACING + f.start);
        f.erupted++;
        const lim = 36;
        if (Math.hypot(p.x, p.z) > lim) continue;
        this.spikes.push({ pos: p, t: 0, size: 0.9 + rng.next() * 0.6, kind: f.kind });
        bus.emit('fissure', { pos: p });
        if (!f.hit && pl.alive && ctx.live) {
          const d = Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z);
          if (d < f.radius + PLAYER_RADIUS && pl.y < 1.4) {
            const res = pl.takeHit({ damage: f.damage, from: p, knockdown: true, knockback: 6, source: 'fissure' });
            if (res !== 'dodged') f.hit = true;
          }
        }
        if (f.hazardDur > 0 && f.erupted % 2 === 0) this.hazard(p, 1.5, f.hazardDur, 10, f.kind, 0.7);
      }
      if (f.dist >= f.length) this.fissures.splice(i, 1);
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.t += dt;
      if (s.t > 1.6) this.spikes.splice(i, 1);
    }

    // telegraphs
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.t += dt;
      if (t.dead || t.t > t.dur + 0.1) this.telegraphs.splice(i, 1);
    }
  }
}
