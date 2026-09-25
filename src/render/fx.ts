import * as THREE from 'three';
import { bus } from '../core/events';
import { Debris, Particles } from './particles';
import type { Hazard } from '../game/threats';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const DUST = new THREE.Color(0.42, 0.4, 0.37);
const DUST_DARK = new THREE.Color(0.25, 0.24, 0.23);
const WATER = new THREE.Color(0.62, 0.7, 0.8);
const EMBER = new THREE.Color(1.0, 0.55, 0.16);
const EMBER_HOT = new THREE.Color(1.0, 0.78, 0.4);
const SPARK = new THREE.Color(1.0, 0.72, 0.4);
const STEEL_SPARK = new THREE.Color(0.85, 0.9, 1.0);
const CYAN = new THREE.Color(0.45, 0.95, 1.0);
const GOLD = new THREE.Color(1.0, 0.8, 0.45);
const SMOKE = new THREE.Color(0.16, 0.15, 0.15);

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Effects director: listens to the event bus and feeds the particle pools and the debris. Also runs the
 * continuous emitters (embers over burning ground, braziers, the golem's cracks, meteor trails).
 */
export class Fx {
  readonly group = new THREE.Group();
  readonly dust = new Particles(1400, 'soft');
  readonly glow = new Particles(1800, 'glow');
  readonly debris: Debris | null;
  private readonly unsub: (() => void)[] = [];
  private acc = new Map<string, number>();

  constructor(debrisGeo: THREE.BufferGeometry | null, debrisMat: THREE.Material | null) {
    this.group.add(this.dust.points, this.glow.points);
    this.debris = debrisGeo && debrisMat ? new Debris(debrisGeo, debrisMat) : null;
    if (this.debris) this.group.add(this.debris.mesh);
    this.hook();
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.dust.setViewport(heightPx, fovDeg);
    this.glow.setViewport(heightPx, fovDeg);
  }

  clear(): void {
    this.dust.clear();
    this.glow.clear();
    this.debris?.clear();
  }

  // ------------------------------------------------------------------ building blocks

  dustRing(pos: THREE.Vector3, r0: number, count: number, speed: number, size: number, life = 1.8, dark = false): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = r0 * Math.sqrt(Math.random());
      _p.set(pos.x + Math.cos(a) * r, 0.3 + Math.random() * 0.6, pos.z + Math.sin(a) * r);
      _v.set(Math.cos(a) * speed * rnd(0.5, 1.1), rnd(0.4, 2.2), Math.sin(a) * speed * rnd(0.5, 1.1));
      this.dust.emit({ pos: _p, vel: _v, life: life * rnd(0.7, 1.2), size: size * rnd(0.6, 1.3), grow: 2.6, color: dark ? DUST_DARK : DUST, alpha: 0.42, drag: 1.8, gravity: -0.3 });
    }
  }

  chunks(pos: THREE.Vector3, count: number, spread: number, up: number, size: number): void {
    if (!this.debris) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      _p.set(pos.x + Math.cos(a) * rnd(0, spread * 0.4), Math.max(0.3, pos.y) + rnd(0, 0.5), pos.z + Math.sin(a) * rnd(0, spread * 0.4));
      _v.set(Math.cos(a) * rnd(2, spread * 2.2), rnd(up * 0.5, up), Math.sin(a) * rnd(2, spread * 2.2));
      this.debris.emit(_p, _v, size * rnd(0.5, 1.2), rnd(2.2, 3.6));
    }
  }

  sparks(pos: THREE.Vector3, normal: THREE.Vector3 | null, count: number, color: THREE.Color, speed = 7, life = 0.45, size = 0.09): void {
    for (let i = 0; i < count; i++) {
      _n.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      if (normal) _n.addScaledVector(normal, 1.2).normalize();
      _v.copy(_n).multiplyScalar(speed * rnd(0.5, 1.3));
      this.glow.emit({ pos, vel: _v, life: life * rnd(0.6, 1.2), size: size * rnd(0.7, 1.4), grow: 0.4, color, alpha: 1, gravity: 12, drag: 1.2, bounce: true });
    }
  }

  flash(pos: THREE.Vector3, color: THREE.Color, size: number, life = 0.14): void {
    this.glow.emit({ pos, vel: _v.set(0, 0, 0), life, size, grow: 1.6, color, alpha: 0.9 });
  }

  splash(pos: THREE.Vector3, count: number, speed = 2.5): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      _p.set(pos.x + Math.cos(a) * 0.2, 0.05, pos.z + Math.sin(a) * 0.2);
      _v.set(Math.cos(a) * speed * rnd(0.3, 1), rnd(1.5, 3.5), Math.sin(a) * speed * rnd(0.3, 1));
      this.dust.emit({ pos: _p, vel: _v, life: rnd(0.3, 0.55), size: rnd(0.08, 0.16), grow: 1.5, color: WATER, alpha: 0.6, gravity: 12 });
    }
  }

  embers(pos: THREE.Vector3, count: number, spread: number, rise = 1.8): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = spread * Math.sqrt(Math.random());
      _p.set(pos.x + Math.cos(a) * r, pos.y + rnd(0, 0.3), pos.z + Math.sin(a) * r);
      _v.set(rnd(-0.4, 0.4) + 0.5, rnd(rise * 0.5, rise * 1.2), rnd(-0.4, 0.4) + 0.3);
      this.glow.emit({ pos: _p, vel: _v, life: rnd(0.9, 1.8), size: rnd(0.06, 0.13), grow: 0.5, color: Math.random() < 0.3 ? EMBER_HOT : EMBER, alpha: 1, gravity: -0.4, drag: 0.6, flicker: 0.7 });
    }
  }

  smoke(pos: THREE.Vector3, count: number, spread: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = spread * Math.sqrt(Math.random());
      _p.set(pos.x + Math.cos(a) * r, pos.y + 0.2, pos.z + Math.sin(a) * r);
      _v.set(rnd(0.2, 0.6), rnd(0.6, 1.3), rnd(0.1, 0.4));
      this.dust.emit({ pos: _p, vel: _v, life: rnd(1.6, 2.6), size: rnd(0.6, 1.1), grow: 3, color: SMOKE, alpha: 0.28, drag: 0.4, gravity: -0.2 });
    }
  }

  /** Emit `rate` per second from fn, accumulated per key. */
  private rate(key: string, rate: number, dt: number, fn: () => void): void {
    let a = (this.acc.get(key) ?? 0) + rate * dt;
    while (a >= 1) {
      fn();
      a -= 1;
    }
    this.acc.set(key, a);
  }

  // ------------------------------------------------------------------ events

  private hook(): void {
    const on = bus.on.bind(bus);
    const u = this.unsub;
    u.push(on('slamImpact', (e) => {
      this.dustRing(e.pos, e.radius * 0.8, e.big ? 60 : 42, 9, 1.6, 2.0);
      this.chunks(e.pos, e.big ? 16 : 10, e.radius, 9, 0.45);
      this.splash(e.pos, 24, 6);
    }));
    u.push(on('stompImpact', (e) => {
      this.dustRing(e.pos, e.radius * 0.6, 36, 8, 1.4);
      this.chunks(e.pos, 6, e.radius * 0.8, 7, 0.35);
    }));
    u.push(on('golemStep', (e) => {
      this.dustRing(e.pos, 1.8, Math.round(8 * e.strength), 2.5, 0.9, 1.2);
      this.splash(e.pos, Math.round(10 * e.strength), 4);
    }));
    u.push(on('rockImpact', (e) => {
      this.dustRing(e.pos, e.radius * 0.7, 26, 6, 1.2, 1.6);
      this.chunks(e.pos, 8, e.radius, 8, 0.35);
      this.embers(e.pos, 12, e.radius * 0.5, 3);
    }));
    u.push(on('fissure', (e) => {
      this.dustRing(e.pos, 1.2, 6, 2, 0.8, 1.2, true);
      this.embers(e.pos, 6, 0.8, 3);
      this.chunks(e.pos, 2, 1.2, 6, 0.25);
    }));
    u.push(on('coreHit', (e) => {
      this.sparks(e.pos, e.normal, e.crit ? 30 : 16, CYAN, 9, 0.5, 0.13);
      this.sparks(e.pos, e.normal, 6, STEEL_SPARK, 6, 0.3, 0.08);
      this.flash(e.pos, CYAN, e.crit ? 2.6 : 1.6);
    }));
    u.push(on('bodyHit', (e) => {
      this.sparks(e.pos, e.normal, 8, SPARK, 6, 0.35);
      this.chunks(e.pos, 2, 1, 4, 0.18);
    }));
    u.push(on('deflect', (e) => {
      this.sparks(e.pos, e.normal, e.heavy ? 22 : 14, SPARK, 8, 0.45);
      this.flash(e.pos, SPARK, 0.7, 0.09);
      this.dustRing(e.pos, 0.2, 3, 1, 0.4, 0.8);
    }));
    u.push(on('playerBlock', (e) => this.sparks(e.pos, null, 12, STEEL_SPARK, 6, 0.35)));
    u.push(on('justGuard', (e) => {
      this.sparks(e.pos, null, 20, GOLD, 7, 0.5);
      this.flash(e.pos, GOLD, 1.2);
    }));
    u.push(on('playerHit', (e) => {
      this.dustRing(e.pos, 0.6, 8, 2, 0.6, 1.0);
      this.sparks(_p.copy(e.pos).setY(1.2), null, 6, STEEL_SPARK, 4, 0.3);
    }));
    u.push(on('roll', (e) => this.splash(e.pos, 8, 3)));
    u.push(on('footstep', (e) => this.splash(e.pos, e.run ? 3 : 2, 1.8)));
    u.push(on('land', (e) => this.splash(e.pos, e.hard ? 14 : 8, 3)));
    u.push(on('assembleChunk', (e) => {
      this.dustRing(e.pos.clone().setY(0), 1.2, 5, 2, 0.8, 1.0);
    }));
    u.push(on('staggerStart', (e) => {
      this.dustRing(e.pos, 6, 60, 7, 1.8, 2.2);
      this.chunks(e.pos, 10, 4, 6, 0.4);
    }));
    u.push(on('roar', (e) => this.dustRing(e.pos, 7, 36, 3, 1.4, 2.4)));
    u.push(on('pushWave', (e) => this.dustRing(e.pos, e.radius * 0.6, 40, 10, 1.3, 1.6)));
    u.push(on('heal', (e) => {
      for (let i = 0; i < 22; i++) {
        _p.set(e.pos.x + rnd(-0.4, 0.4), rnd(0.2, 1.6), e.pos.z + rnd(-0.4, 0.4));
        _v.set(rnd(-0.2, 0.2), rnd(0.6, 1.4), rnd(-0.2, 0.2));
        this.glow.emit({ pos: _p, vel: _v, life: rnd(0.8, 1.4), size: rnd(0.06, 0.12), grow: 0.4, color: GOLD, alpha: 1, drag: 1, flicker: 0.4 });
      }
    }));
    u.push(on('golemDeath', (e) => {
      this.deathDust = 3.5;
      this.deathPos.copy(e.pos);
    }));
  }

  private deathDust = 0;
  private readonly deathPos = new THREE.Vector3();

  /**
   * Continuous emitters. hazards: burning ground; braziers: fire spots; golemPoints: sample points on the
   * golem's body (phase 2/3 cracks shed embers); meteors: rocks in flight that trail fire.
   */
  update(dt: number, time: number, ctx: {
    hazards: Hazard[];
    braziers: THREE.Vector3[];
    golemPoints: THREE.Vector3[];
    phase: number;
    meteors: THREE.Vector3[];
  }): void {
    for (const h of ctx.hazards) {
      if (h.t < h.arm - 1 || h.dur - h.t < 0.3) continue;
      const burning = h.t >= h.arm;
      this.rate(`hz${h.seed}`, (burning ? 10 : 4) * h.radius * 0.4, dt, () => this.embers(h.pos, 1, h.radius * 0.85, burning ? 2 : 1));
      if (burning) this.rate(`hs${h.seed}`, 2.2, dt, () => this.smoke(h.pos, 1, h.radius * 0.7));
    }
    ctx.braziers.forEach((b, i) => {
      this.rate(`br${i}`, 5, dt, () => this.embers(_p.copy(b).setY(b.y + 0.3), 1, 0.3, 2.2));
      this.rate(`bs${i}`, 1.2, dt, () => this.smoke(_p.copy(b).setY(b.y + 0.8), 1, 0.2));
    });
    if (ctx.phase >= 2 && ctx.golemPoints.length) {
      this.rate('golem', ctx.phase >= 3 ? 16 : 6, dt, () => {
        const p = ctx.golemPoints[Math.floor(Math.random() * ctx.golemPoints.length)];
        this.embers(p, 1, 1.0, 1.2);
      });
    }
    ctx.meteors.forEach((m, i) => this.rate(`mt${i}`, 30, dt, () => this.embers(m, 1, 0.8, 0.5)));
    if (this.deathDust > 0) {
      this.deathDust -= dt;
      this.rate('death', 30, dt, () => this.dustRing(this.deathPos, 6, 1, 2, 1.6, 2.4));
    }
    this.dust.update(dt, time);
    this.glow.update(dt, time);
    this.debris?.update(dt);
  }

  dispose(): void {
    for (const f of this.unsub) f();
  }
}
