import * as THREE from 'three';
import { bus } from '../core/events';
import { Debris, Particles } from './particles';
import { crackTexture } from './threatView';
import type { Hazard } from '../game/threats';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const DUST = new THREE.Color(0.26, 0.25, 0.24);
const DUST_DARK = new THREE.Color(0.16, 0.155, 0.15);
const WATER = new THREE.Color(0.62, 0.7, 0.8);
const EMBER = new THREE.Color(1.0, 0.55, 0.16);
const EMBER_HOT = new THREE.Color(1.0, 0.78, 0.4);
const SPARK = new THREE.Color(1.0, 0.72, 0.4);
const STEEL_SPARK = new THREE.Color(0.85, 0.9, 1.0);
const SLASH = new THREE.Color(1.6, 2.2, 2.4);
const CYAN = new THREE.Color(0.45, 0.95, 1.0);
const GOLD = new THREE.Color(1.0, 0.8, 0.45);
const SMOKE = new THREE.Color(0.16, 0.15, 0.15);
const STEAM = new THREE.Color(0.62, 0.64, 0.68);

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
    for (const s of this.scars) s.mesh.visible = false;
  }

  // ------------------------------------------------------------------ crack scars

  private readonly scars: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number }[] = [];
  private scarNext = 0;

  /** A fresh crack in the flagstones (pale grit in broken stone) that fades over a couple of seconds. */
  scar(pos: THREE.Vector3, size: number): void {
    if (!this.scars.length) {
      const tex = crackTexture();
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: 0x8a837b, alphaMap: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.scars.push({ mesh, mat, t: 99 });
      }
    }
    const s = this.scars[this.scarNext++ % this.scars.length];
    s.mesh.position.set(pos.x, 0.03, pos.z);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mesh.scale.setScalar(size);
    s.mesh.visible = true;
    s.t = 0;
  }

  private updateScars(dt: number): void {
    for (const s of this.scars) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      s.mat.opacity = 0.85 * Math.min(1, s.t / 0.04) * Math.max(0, 1 - Math.max(0, s.t - 1.4) / 1.2);
      if (s.t > 2.6) s.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------------ building blocks

  dustRing(pos: THREE.Vector3, r0: number, count: number, speed: number, size: number, life = 1.8, dark = false, alpha = 0.22): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = r0 * Math.sqrt(Math.random());
      _p.set(pos.x + Math.cos(a) * r, 0.3 + Math.random() * 0.6, pos.z + Math.sin(a) * r);
      _v.set(Math.cos(a) * speed * rnd(0.5, 1.1), rnd(0.4, 2.2), Math.sin(a) * speed * rnd(0.5, 1.1));
      this.dust.emit({ pos: _p, vel: _v, life: life * rnd(0.7, 1.2), size: size * rnd(0.8, 1.6), grow: 2.8, color: dark ? DUST_DARK : DUST, alpha, drag: 1.8, gravity: -0.3 });
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

  /** A tongue of flame: a big soft glow sprite that rises and shrinks quickly. */
  flameLick(pos: THREE.Vector3, spread: number): void {
    const a = Math.random() * Math.PI * 2;
    const r = spread * Math.sqrt(Math.random());
    _p.set(pos.x + Math.cos(a) * r, 0.15, pos.z + Math.sin(a) * r);
    _v.set(rnd(-0.2, 0.2), rnd(1.4, 2.4), rnd(-0.2, 0.2));
    this.glow.emit({ pos: _p, vel: _v, life: rnd(0.4, 0.7), size: rnd(0.6, 1.1), grow: 0.25, color: Math.random() < 0.5 ? EMBER : EMBER_HOT, alpha: 0.7, drag: 0.5, flicker: 0.4 });
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
      // a crater in the flagstones, a low, fast dust wave rolling out, a slower cloud, chunks thrown high and a splash
      this.scar(e.pos, e.radius * (e.big ? 1.5 : 1.25));
      this.dustRing(e.pos, e.radius * 0.5, e.big ? 64 : 44, 16, 1.5, 1.2, true, 0.42);
      this.dustRing(e.pos, e.radius * 0.8, e.big ? 60 : 42, 7, 1.9, 2.4, false, 0.36);
      this.chunks(e.pos, e.big ? 26 : 18, e.radius, 11, 0.62);
      this.splash(e.pos, 32, 7);
      // a column of dust boiling up where the fist struck
      for (let i = 0; i < (e.big ? 34 : 24); i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rnd(0, e.radius * 0.35);
        _p.set(e.pos.x + Math.cos(a) * r, rnd(0.2, 1.2), e.pos.z + Math.sin(a) * r);
        _v.set(Math.cos(a) * rnd(0.4, 1.4), rnd(2.5, 6), Math.sin(a) * rnd(0.4, 1.4));
        this.dust.emit({ pos: _p, vel: _v, life: rnd(1.1, 1.9), size: rnd(1.1, 2), grow: 2.6, color: DUST, alpha: 0.4, drag: 1.4, gravity: 0.6 });
      }
    }));
    u.push(on('stompImpact', (e) => {
      this.dustRing(e.pos, e.radius * 0.6, 36, 8, 1.4);
      this.chunks(e.pos, 6, e.radius * 0.8, 7, 0.35);
    }));
    u.push(on('golemStep', (e) => {
      this.dustRing(e.pos, 1.8, Math.round(8 * e.strength), 2.5, 0.9, 1.2);
      this.splash(e.pos, Math.round(10 * e.strength), 4);
    }));
    u.push(on('rockShatter', (e) => {
      // the boulder breaks into big fragments that carry on in its direction, and a burst of grit
      if (this.debris) {
        for (let i = 0; i < 10; i++) {
          _v.copy(e.vel).multiplyScalar(rnd(0.15, 0.35));
          _v.x += rnd(-4, 4);
          _v.y = Math.abs(_v.y) * 0.2 + rnd(2, 6);
          _v.z += rnd(-4, 4);
          _p.set(e.pos.x + rnd(-0.5, 0.5) * e.size, Math.max(0.3, e.pos.y + rnd(-0.4, 0.4) * e.size), e.pos.z + rnd(-0.5, 0.5) * e.size);
          this.debris.emit(_p, _v, e.size * rnd(0.3, 0.55), rnd(2, 3.2));
        }
      }
      for (let i = 0; i < 14; i++) {
        _v.set(rnd(-1, 1) * 3, rnd(0.2, 2.2), rnd(-1, 1) * 3);
        _p.set(e.pos.x, Math.max(0.3, e.pos.y), e.pos.z);
        this.dust.emit({ pos: _p, vel: _v, life: rnd(0.8, 1.4), size: e.size * rnd(0.8, 1.4), grow: 2.4, color: DUST, alpha: 0.38, drag: 2, gravity: -0.2 });
      }
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
      // a bright slash across the core: the cut itself, whatever frame the eye catches
      _q.crossVectors(e.normal, UP);
      if (_q.lengthSq() < 1e-4) _q.set(1, 0, 0);
      _q.normalize();
      _q.y += 0.45;
      _q.normalize();
      const n = e.crit ? 15 : 11;
      const len = e.heavy || e.crit ? 1.5 : 1.1;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1) - 0.5;
        _p.copy(e.pos).addScaledVector(_q, k * len).addScaledVector(e.normal, 0.15);
        const mid = 1 - Math.abs(k) * 1.4;
        this.glow.emit({ pos: _p, vel: _v.copy(_q).multiplyScalar(k * 1.2), life: 0.15, size: 0.08 + 0.2 * mid, grow: 0.3, color: SLASH, alpha: 1, drag: 3 });
      }
      this.sparks(e.pos, e.normal, e.crit ? 30 : 16, CYAN, 9, 0.5, 0.13);
      this.sparks(e.pos, e.normal, 6, STEEL_SPARK, 6, 0.3, 0.08);
      this.flash(e.pos, CYAN, e.crit ? 2.8 : 2.0, 0.18);
    }));
    u.push(on('bodyHit', (e) => {
      this.sparks(e.pos, e.normal, 8, SPARK, 6, 0.35);
      this.chunks(e.pos, 2, 1, 4, 0.18);
    }));
    u.push(on('deflect', (e) => {
      // blade on stone: a fan of hot sparks, white steel sparks, stone chips and a puff of grit
      // mostly white steel on grey stone (hot orange belongs to fire, cyan to cores)
      this.sparks(e.pos, e.normal, e.heavy ? 36 : 26, SPARK, 12, 0.55, 0.2);
      this.sparks(e.pos, e.normal, e.heavy ? 40 : 30, STEEL_SPARK, 13, 0.5, 0.2);
      this.flash(e.pos, SPARK, e.heavy ? 3.2 : 2.6, 0.14);
      if (this.debris) {
        for (let i = 0; i < (e.heavy ? 10 : 7); i++) {
          _v.set(e.normal.x * rnd(2, 5) + rnd(-2, 2), rnd(2, 5), e.normal.z * rnd(2, 5) + rnd(-2, 2));
          this.debris.emit(e.pos, _v, rnd(0.1, 0.22), rnd(1.2, 2));
        }
      }
      for (let i = 0; i < 6; i++) {
        _v.set(e.normal.x * rnd(0.5, 1.5) + rnd(-0.6, 0.6), rnd(0.2, 1), e.normal.z * rnd(0.5, 1.5) + rnd(-0.6, 0.6));
        this.dust.emit({ pos: e.pos, vel: _v, life: rnd(0.5, 0.9), size: rnd(0.35, 0.6), grow: 2.4, color: DUST, alpha: 0.28, drag: 2.4, gravity: -0.1 });
      }
    }));
    u.push(on('playerBlock', (e) => this.sparks(e.pos, null, 12, STEEL_SPARK, 6, 0.35)));
    u.push(on('justGuard', (e) => {
      this.sparks(e.pos, null, 20, GOLD, 7, 0.5);
      this.flash(e.pos, GOLD, 1.2);
    }));
    u.push(on('playerHit', (e) => {
      const heavy = e.damage >= 25 || e.knockdown;
      _p.copy(e.pos).setY(1.15);
      this.dustRing(e.pos, 0.8, heavy ? 16 : 10, heavy ? 4 : 2.5, 0.7, 1.1);
      this.sparks(_p, null, heavy ? 26 : 16, STEEL_SPARK, 7, 0.4, 0.15);
      // a rock or a fist: stone shatters on the warrior, wider than the body so the burst shows from behind
      if (e.source !== 'hazard' && e.source !== 'push') {
        this.flash(_p, SPARK, heavy ? 2.6 : 1.6, 0.12);
        if (this.debris) {
          for (let i = 0; i < (heavy ? 14 : 6); i++) {
            const a = Math.random() * Math.PI * 2;
            _v.set(Math.cos(a) * rnd(3, 7), rnd(2.5, 7), Math.sin(a) * rnd(3, 7));
            _q.set(_p.x + Math.cos(a) * 0.35, _p.y + rnd(-0.3, 0.4), _p.z + Math.sin(a) * 0.35);
            this.debris.emit(_q, _v, rnd(0.12, heavy ? 0.32 : 0.2), rnd(1.4, 2.4));
          }
        }
        if (heavy) {
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            _v.set(Math.cos(a) * rnd(1.5, 3.5), rnd(0.3, 1.8), Math.sin(a) * rnd(1.5, 3.5));
            this.dust.emit({ pos: _p, vel: _v, life: rnd(0.7, 1.2), size: rnd(0.6, 1.1), grow: 2.6, color: DUST, alpha: 0.4, drag: 2.2, gravity: -0.15 });
          }
        }
      }
    }));
    u.push(on('heavyLand', (e) => {
      // the heavy chop bites the floor: a crack scar, chips, grit and a spray of steel sparks
      this.scar(e.pos, e.charged ? 2.1 : 1.4);
      this.dustRing(e.pos, 0.35, e.charged ? 18 : 11, e.charged ? 4.2 : 3, 0.6, 0.95);
      this.chunks(e.pos, e.charged ? 8 : 5, 0.5, 5.5, 0.17);
      _q.copy(e.pos).setY(0.1);
      this.sparks(_q, UP, e.charged ? 26 : 16, STEEL_SPARK, 7, 0.4, 0.12);
      this.flash(_q, e.charged ? GOLD : STEEL_SPARK, e.charged ? 1.6 : 1.0, 0.12);
      this.splash(e.pos, e.charged ? 12 : 8, 3);
    }));
    u.push(on('dodged', (e) => {
      // a clean dodge: a silver shimmer peels off around the warrior (starting outside the body, so the
      // tumbling silhouette stays readable instead of turning into a white ghost)
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        _p.set(e.pos.x + Math.cos(a) * 0.75, rnd(0.2, 1.2), e.pos.z + Math.sin(a) * 0.75);
        _v.set(Math.cos(a) * rnd(1.8, 3.2), rnd(0.2, 1.2), Math.sin(a) * rnd(1.8, 3.2));
        this.glow.emit({ pos: _p, vel: _v, life: rnd(0.25, 0.4), size: rnd(0.06, 0.1), grow: 0.4, color: STEEL_SPARK, alpha: 0.75, drag: 2 });
      }
    }));
    u.push(on('hazardBurn', (e) => {
      // burning: embers, a lick of flame and steam hissing off the wet armour
      this.embers(e.pos, 4, 0.35, 1.6);
      this.flameLick(e.pos, 0.35);
      for (let i = 0; i < 5; i++) {
        _p.set(e.pos.x + rnd(-0.3, 0.3), rnd(0.4, 1.6), e.pos.z + rnd(-0.3, 0.3));
        _v.set(rnd(-0.3, 0.3), rnd(1.2, 2.2), rnd(-0.3, 0.3));
        this.dust.emit({ pos: _p, vel: _v, life: rnd(0.6, 1), size: rnd(0.4, 0.7), grow: 2.2, color: STEAM, alpha: 0.35, drag: 1, gravity: -0.4 });
      }
    }));
    u.push(on('roll', (e) => {
      this.splash(e.pos, 16, 3.5);
      this.dustRing(e.pos, 0.3, 6, 2.2, 0.5, 0.7, false, 0.3);
    }));
    u.push(on('swing', (e) => {
      // a heavy blow kicks up a ring of grit and spray at the warrior's feet
      if (!e.heavy) return;
      this.dustRing(e.pos, 0.6, e.charged ? 14 : 8, e.charged ? 5 : 3.5, 0.55, 0.8);
      this.splash(e.pos, e.charged ? 12 : 7, 3);
    }));
    u.push(on('heavyCharge', (e) => {
      // motes drawn in toward the blade while a heavy attack charges; more as the charge fills
      for (let i = 0; i < 2 + Math.round(e.charge * 4); i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rnd(0.6, 1.3);
        _p.set(e.pos.x + Math.cos(a) * r, e.pos.y + rnd(-0.4, 0.5), e.pos.z + Math.sin(a) * r);
        _v.set(e.pos.x - _p.x, e.pos.y - _p.y, e.pos.z - _p.z).multiplyScalar(2.6);
        this.glow.emit({ pos: _p, vel: _v, life: 0.38, size: rnd(0.1, 0.18), grow: 0.4, color: e.full ? GOLD : SPARK, alpha: 1, drag: 0.5 });
      }
    }));
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
    waves?: { center: THREE.Vector3; r: number; maxR: number }[];
  }): void {
    this.updateScars(dt);
    for (const [i, w] of (ctx.waves ?? []).entries()) {
      if (w.r < 1 || w.r > w.maxR - 0.5) continue;
      this.rate(`wv${i}`, 40 + w.r * 4, dt, () => {
        const a = Math.random() * Math.PI * 2;
        _p.set(w.center.x + Math.sin(a) * w.r, 0.25, w.center.z + Math.cos(a) * w.r);
        _v.set(Math.sin(a) * 2.6, rnd(0.8, 2.0), Math.cos(a) * 2.6);
        this.dust.emit({ pos: _p, vel: _v, life: rnd(0.5, 0.9), size: rnd(0.8, 1.4), grow: 2.2, color: DUST, alpha: 0.42, drag: 2.2, gravity: -0.2 });
      });
      this.rate(`ws${i}`, 30 + w.r * 3, dt, () => this.splash(_p.set(w.center.x + Math.sin(Math.random() * 6.283) * w.r, 0, w.center.z + Math.cos(Math.random() * 6.283) * w.r), 2, 2.4));
    }
    for (const h of ctx.hazards) {
      if (h.t < h.arm - 1 || h.dur - h.t < 0.3) continue;
      const burning = h.t >= h.arm;
      this.rate(`hz${h.seed}`, (burning ? 6 : 2) * h.radius * 0.4, dt, () => this.embers(h.pos, 1, h.radius * 0.85, burning ? 2 : 1));
      if (burning) {
        this.rate(`hs${h.seed}`, 4.5, dt, () => this.smoke(h.pos, 1, h.radius * 0.7));
        this.rate(`hf${h.seed}`, 7 * h.radius, dt, () => this.flameLick(h.pos, h.radius * 0.8));
      }
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
