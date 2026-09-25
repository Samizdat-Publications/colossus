import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, noise1, smoothstep, DEG } from '../core/math';
import type { Player } from '../game/player';
import type { Golem } from '../game/golem';
import type { World } from '../game/world';
import { ARENA } from '../game/world';

export interface CineShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _c = new THREE.Vector3();
const _freePos = new THREE.Vector3();
const _freeLook = new THREE.Vector3();
const _lockPos = new THREE.Vector3();
const _lockLook = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _lookPos = new THREE.Vector3();

/** Fraction of the vertical field of view kept free above the golem and below the warrior's feet. */
const TOP_MARGIN = 0.1; // leaves the top strip for tips (the director can ask for more: topMargin)
const BOTTOM_MARGIN = 0.16; // keeps the feet above the (see-through) boss health panel
const FOV_MIN = 58;
const FOV_MAX = 72; // wider lenses stretched the frame edges and shrank the warrior

/**
 * Third-person camera.
 * - Free mode: mouse orbit around the warrior.
 * - Lock-on: a framing solve. Each frame it picks the pitch and field of view that keep both the
 *   warrior's feet (above the HUD) and the golem's highest point (head or raised fists) in frame,
 *   and pulls back when both cannot fit. Nothing ever pushes the camera into the golem: golem parts
 *   that block the view are faded by the renderer instead.
 * - Cinematic shots blend in on top; trauma shake applies last.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.24;
  readonly baseDist = 7.6;
  private dist = 7.6;
  private readonly pivot = new THREE.Vector3(0, 1.9, 25);
  private lockW = 0;
  private trauma = 0;
  private kickAmt = 0;
  private time = 0;
  private fov = 60;
  private lockPitch = 0.1;
  private lockFov = 60;
  private pullBack = 0;
  private lockDist = 8.6;
  shakeScale = 1;
  /** 0 = gameplay, 1 = cinematic shot fully applied. */
  cineBlend = 0;
  readonly cine: CineShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  /** Direction the camera faces on the ground plane (for camera-relative movement). */
  moveYaw = Math.PI;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 900);
  }

  snapBehind(player: Player, yaw?: number): void {
    this.yaw = yaw ?? player.yaw;
    this.pitch = 0.24;
    this.pivot.set(player.pos.x, player.y + 1.9, player.pos.z);
    this.dist = this.baseDist;
    this.pullBack = 0;
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kick(amount: number): void {
    this.kickAmt = Math.min(1, this.kickAmt + amount);
  }

  /** Pull the camera toward the pivot if walls or pillars sit between them. */
  private collide(world: World, from: THREE.Vector3, to: THREE.Vector3): void {
    const steps = 16;
    _c.subVectors(to, from);
    const len = _c.length();
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      _q.copy(from).addScaledVector(_c, u);
      if (world.blocked(_q.x, _q.y, _q.z, 0.35) || Math.hypot(_q.x, _q.z) > ARENA.wallRadius - 0.6) {
        const keep = Math.max(1.2 / Math.max(len, 1e-3), u - 1 / steps);
        to.copy(from).addScaledVector(_c, keep);
        break;
      }
    }
    to.y = Math.max(0.4, to.y);
  }

  /** Ground points that must stay in frame (near edges of warning rings around the warrior). */
  readonly mustSee: THREE.Vector3[] = [];
  /** Points the camera tries to keep in frame when it can (rocks in flight). */
  readonly niceToSee: THREE.Vector3[] = [];
  /** Extra pull-back requested by the director for big moments (leap, stagger), in metres. */
  wide = 0;
  private wideNow = 0;
  /** Extra camera height requested by the director (look down on a kneeling golem), in metres. */
  rise = 0;
  private riseNow = 0;
  private sideNow = 0.75;
  /** Only these golem capsules (by name) count for the top of the frame; null = all. */
  topParts: Set<string> | null = null;
  /** Metres added to the golem's top for framing (the director anticipates a leap's apex). */
  topBoost = 0;
  /** 0..1: how fast pitch and field of view follow the solve (1 for fast moves like the leap). */
  snappy = 0;
  /** Largest automatic pull-back in metres (the director raises it for the leap). */
  maxPull = 3;
  /** Fraction of the view kept clear above the golem's top (more for the leap and the meteor call). */
  topMargin = TOP_MARGIN;
  private topMarginNow = TOP_MARGIN;

  update(dt: number, lookX: number, lookY: number, player: Player, golem: Golem, world: World): void {
    this.time += dt;
    const locked = player.locked && golem.lockable;
    this.lockW = damp(this.lockW, locked ? 1 : 0, 6, dt);

    // pivot follows the warrior's upper body
    _t.set(player.pos.x, player.y * 0.7 + 1.9, player.pos.z);
    this.pivot.x = damp(this.pivot.x, _t.x, 16, dt);
    this.pivot.z = damp(this.pivot.z, _t.z, 16, dt);
    this.pivot.y = damp(this.pivot.y, _t.y, 9, dt);

    golem.lockPoint(_p);
    const dGolem = Math.hypot(_p.x - player.pos.x, _p.z - player.pos.z);
    if (locked) {
      this.yaw = dampAngle(this.yaw, Math.atan2(_p.x - player.pos.x, _p.z - player.pos.z), 7, dt);
    } else {
      this.yaw -= lookX;
      this.pitch = clamp(this.pitch - lookY, -0.45, 1.05);
    }
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x); // camera right on the ground plane

    // ---------------- free orbit
    {
      const cp = Math.cos(this.pitch);
      const sp = Math.sin(this.pitch);
      _freePos.set(this.pivot.x - _f.x * this.baseDist * cp, this.pivot.y + this.baseDist * sp, this.pivot.z - _f.z * this.baseDist * cp);
      this.collide(world, this.pivot, _freePos);
      _freeLook.copy(this.pivot);
      _freeLook.y += 0.25;
    }

    // ---------------- lock-on framing solve
    if (this.lockW > 0.001) {
      const close = smoothstep(14, 4, dGolem);
      this.wideNow = damp(this.wideNow, this.wide, this.wide > this.wideNow ? 2.5 : 1.2, dt);
      const wantDist = 8.6 + close * 0.8 + this.pullBack + this.wideNow;
      this.lockDist = damp(this.lockDist, wantDist, 3, dt);
      this.riseNow = damp(this.riseNow, this.rise, 2.5, dt);
      const camH = Math.max(1.3, this.pivot.y + 0.7 - close * 0.8 + (this.pullBack + this.wideNow) * 0.35 + this.riseNow);
      // over the shoulder: the warrior sits left of centre so it never hides what it is fighting
      // (further aside while the golem kneels: the back core is right in front of the warrior)
      this.sideNow = damp(this.sideNow, golem.staggered ? 1.7 : 0.75, 3, dt);
      _lockPos.set(this.pivot.x - _f.x * this.lockDist + _r.x * this.sideNow, camH, this.pivot.z - _f.z * this.lockDist + _r.z * this.sideNow);
      this.collide(world, _t.set(this.pivot.x, camH, this.pivot.z), _lockPos);

      const aspect = this.camera.aspect;
      const angleOf = (x: number, y: number, z: number): number | null => {
        const dx = x - _lockPos.x;
        const dz = z - _lockPos.z;
        const h = dx * _f.x + dz * _f.z;
        if (h < 1.0) return null;
        const lat = dx * _r.x + dz * _r.z;
        const hHalf = Math.atan(Math.tan((this.lockFov * DEG) / 2) * aspect);
        if (Math.abs(Math.atan2(lat, h)) > hHalf * 1.05) return null;
        return Math.atan2(y - _lockPos.y, h);
      };
      // the warrior and the warnings around them are a hard constraint; the golem's top is soft
      let feet = angleOf(player.pos.x, player.y, player.pos.z) ?? -0.2;
      for (const m of this.mustSee) {
        const a = angleOf(m.x, m.y, m.z);
        if (a !== null && a < feet) feet = a;
      }
      let top = feet;
      const tops = this.topParts;
      for (const c of golem.capsules) {
        if (tops && !tops.has(c.name)) continue;
        for (const q of [c.a, c.b]) {
          const a = angleOf(q.x, q.y + c.r * 0.6 + this.topBoost, q.z);
          if (a !== null && a > top) top = a;
        }
      }
      for (const n of this.niceToSee) {
        const a = angleOf(n.x, n.y + 1, n.z);
        if (a !== null && a > top) top = a;
      }
      this.topMarginNow = damp(this.topMarginNow, this.topMargin, 3, dt);
      const tm = this.topMarginNow;
      const span = top - feet;
      const needFov = span / (1 - tm - BOTTOM_MARGIN);
      const fov = clamp(needFov / DEG, FOV_MIN, FOV_MAX + Math.min(4, this.wideNow)) * DEG;
      const lo = top - fov * (0.5 - tm);
      const hi = feet + fov * (0.5 - BOTTOM_MARGIN);
      // when both cannot fit, the ground around the warrior wins and the camera pulls back
      const pitch = lo <= hi ? (lo + hi) / 2 : hi;
      if (needFov > FOV_MAX * DEG * 1.02) this.pullBack = Math.min(this.maxPull, this.pullBack + dt * (2 + 4 * this.snappy));
      else if (needFov < FOV_MAX * DEG * 0.85) this.pullBack = Math.max(0, this.pullBack - dt * 0.8);
      this.lockPitch = damp(this.lockPitch, pitch, lerp(4, 10, this.snappy), dt);
      this.lockFov = damp(this.lockFov, fov / DEG, lerp(3, 8, this.snappy), dt);
      // hard constraint, no lag: a knockback or a camera push must never drop the warrior's feet (or a
      // ring they stand in) below the frame
      const hiNow = feet + this.lockFov * DEG * (0.5 - BOTTOM_MARGIN);
      if (this.lockPitch > hiNow) this.lockPitch = hiNow;
      _lockLook.set(
        _lockPos.x + _f.x * Math.cos(this.lockPitch) * 10,
        _lockPos.y + Math.sin(this.lockPitch) * 10,
        _lockPos.z + _f.z * Math.cos(this.lockPitch) * 10,
      );
      // keep free-mode pitch continuous when the lock is released
      if (locked) this.pitch = clamp(Math.atan2(_lockPos.y - this.pivot.y, this.lockDist), -0.45, 1.05);
    }

    // ---------------- blend modes and cinematic
    const w = this.lockW;
    _camPos.lerpVectors(_freePos, _lockPos, w);
    _lookPos.lerpVectors(_freeLook, _lockLook, w);
    let fov = lerp(60, this.lockFov, w);
    if (this.cineBlend > 0.001) {
      const b = this.cineBlend;
      _camPos.lerp(this.cine.pos, b);
      _lookPos.lerp(this.cine.look, b);
      fov = lerp(fov, this.cine.fov, b);
    }
    this.fov = damp(this.fov, fov, 8, dt);
    const cam = this.camera;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    // shake
    const tr = this.trauma * this.trauma * this.shakeScale;
    const t = this.time * 23;
    cam.position.copy(_camPos);
    cam.position.x += noise1(t, 1) * tr * 0.5;
    // the Camera shake setting scales the kicks too (0 = a perfectly steady camera)
    cam.position.y += noise1(t, 2) * tr * 0.45 - this.kickAmt * 0.25 * this.shakeScale;
    cam.position.z += noise1(t, 3) * tr * 0.5;
    cam.lookAt(_lookPos);
    cam.rotateZ(noise1(t * 0.8, 4) * tr * 0.05);
    this.trauma = Math.max(0, this.trauma - dt * 1.25);
    this.kickAmt = Math.max(0, this.kickAmt - dt * 5);

    cam.getWorldDirection(_c);
    this.moveYaw = Math.atan2(_c.x, _c.z);
    void this.dist;
  }

  /** Title-screen orbit around the arena. */
  orbit(dt: number, center: THREE.Vector3, radius: number, height: number, speed: number): void {
    this.time += dt;
    const a = this.time * speed + 2.4;
    this.camera.position.set(center.x + Math.sin(a) * radius, height, center.z + Math.cos(a) * radius);
    this.camera.fov = damp(this.camera.fov, 50, 3, dt);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center.x, center.y, center.z);
    this.camera.getWorldDirection(_c);
    this.moveYaw = Math.atan2(_c.x, _c.z);
  }
}
