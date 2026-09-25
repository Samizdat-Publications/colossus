import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, noise1, smoothstep } from '../core/math';
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
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _c = new THREE.Vector3();
const _look = new THREE.Vector3();
const _want = new THREE.Vector3();

/**
 * Third-person orbit camera with lock-on framing, collision pull-in, trauma shake and a
 * cinematic mode that blends to and from scripted shots.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.24;
  readonly baseDist = 7.8;
  private dist = 7.8;
  /** Extra pitch when the golem would block the camera: rise over it instead of pushing in. */
  private pitchBoost = 0;
  private readonly pivot = new THREE.Vector3(0, 1.6, 25);
  private readonly lookPos = new THREE.Vector3();
  private lockW = 0;
  private trauma = 0;
  private kickAmt = 0;
  private time = 0;
  private fov = 60;
  /** Lock-on framing: extra look-up (metres) and extra field of view so the whole golem stays in view. */
  private lift = 0;
  private zoom = 0;
  shakeScale = 1;
  /** 0 = gameplay, 1 = cinematic shot fully applied. */
  cineBlend = 0;
  readonly cine: CineShot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  /** Direction the camera faces on the ground plane (for camera-relative movement). */
  moveYaw = Math.PI;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 600);
  }

  snapBehind(player: Player, yaw?: number): void {
    this.yaw = yaw ?? player.yaw;
    this.pitch = 0.24;
    this.pitchBoost = 0;
    this.pivot.set(player.pos.x, player.y + 1.6, player.pos.z);
    this.dist = this.baseDist;
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  kick(amount: number): void {
    this.kickAmt = Math.min(1, this.kickAmt + amount);
  }

  update(dt: number, lookX: number, lookY: number, player: Player, golem: Golem, world: World): void {
    this.time += dt;
    const locked = player.locked && golem.lockable;
    this.lockW = damp(this.lockW, locked ? 1 : 0, 6, dt);

    // pivot follows the player's upper body
    _t.set(player.pos.x, player.y * 0.7 + 1.9, player.pos.z);
    this.pivot.x = damp(this.pivot.x, _t.x, 16, dt);
    this.pivot.z = damp(this.pivot.z, _t.z, 16, dt);
    this.pivot.y = damp(this.pivot.y, _t.y, 9, dt);

    golem.lockPoint(_p);
    const dGolem = Math.hypot(_p.x - player.pos.x, _p.z - player.pos.z);
    if (locked) {
      const want = Math.atan2(_p.x - player.pos.x, _p.z - player.pos.z);
      this.yaw = dampAngle(this.yaw, want, 7, dt);
      const wantPitch = lerp(0.08, 0.26, smoothstep(6, 26, dGolem));
      this.pitch = damp(this.pitch, wantPitch, 4, dt);
      this.pitch = clamp(this.pitch - lookY * 0.15, -0.3, 0.7);
    } else {
      this.yaw -= lookX;
      this.pitch = clamp(this.pitch - lookY, -0.5, 1.05);
    }

    // desired camera position
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const wantDist = this.baseDist + (locked ? smoothstep(10, 3, dGolem) * 1.4 : 0);
    // Collision: walls and pillars pull the camera in; the golem's body makes it rise over the rock.
    const probe = (pitch: number): { free: number; golem: boolean } => {
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const steps = 16;
      for (let i = 1; i <= steps; i++) {
        const d = (wantDist * i) / steps;
        _q.set(this.pivot.x - _f.x * d * cp, this.pivot.y + d * sp, this.pivot.z - _f.z * d * cp);
        if (world.blocked(_q.x, _q.y, _q.z, 0.35) || Math.hypot(_q.x, _q.z) > ARENA.wallRadius - 0.6 || _q.y < 0.35) {
          return { free: Math.max(1.2, d - wantDist / steps), golem: false };
        }
        for (const c of golem.capsules) {
          closest(c.a, c.b, _q, _c);
          if (_c.distanceToSquared(_q) < (c.r + 0.45) ** 2) return { free: Math.max(1.2, d - wantDist / steps), golem: true };
        }
      }
      return { free: wantDist, golem: false };
    };
    let pr = probe(this.pitch + this.pitchBoost);
    if (pr.golem && pr.free < wantDist * 0.8) this.pitchBoost = Math.min(0.75, this.pitchBoost + dt * 1.6);
    else if (!pr.golem || pr.free >= wantDist) this.pitchBoost = Math.max(0, this.pitchBoost - dt * 0.5);
    const pitchUsed = this.pitch + this.pitchBoost;
    pr = probe(pitchUsed);
    const free = pr.free;
    const cp = Math.cos(pitchUsed);
    const sp = Math.sin(pitchUsed);
    this.dist = free < this.dist ? damp(this.dist, free, 22, dt) : damp(this.dist, free, 3, dt);
    const camPos = _q.set(this.pivot.x - _f.x * this.dist * cp, Math.max(0.35, this.pivot.y + this.dist * sp), this.pivot.z - _f.z * this.dist * cp);

    // look target: ahead of the player, pulled toward the golem when locked
    _want.copy(this.pivot);
    _want.y += 0.25;
    if (this.lockW > 0.001) {
      const w = lerp(0.18, 0.42, smoothstep(22, 5, dGolem));
      _look.lerpVectors(this.pivot, _p, w);
      _look.y += this.lift;
      _want.lerp(_look, this.lockW);
    }
    this.lookPos.copy(_want);

    // blend with cinematic shot
    let fov = lerp(60, 64, this.lockW * smoothstep(12, 4, dGolem)) + this.zoom * this.lockW;
    const cam = this.camera;
    if (this.cineBlend > 0.001) {
      const b = this.cineBlend;
      camPos.lerp(this.cine.pos, b);
      this.lookPos.lerp(this.cine.look, b);
      fov = lerp(fov, this.cine.fov, b);
    }
    this.fov = damp(this.fov, fov, 6, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();

    // shake
    const tr = this.trauma * this.trauma * this.shakeScale;
    const t = this.time * 23;
    cam.position.copy(camPos);
    cam.position.x += noise1(t, 1) * tr * 0.5;
    cam.position.y += noise1(t, 2) * tr * 0.45 - this.kickAmt * 0.25;
    cam.position.z += noise1(t, 3) * tr * 0.5;
    cam.lookAt(this.lookPos);
    cam.rotateZ(noise1(t * 0.8, 4) * tr * 0.05);
    this.trauma = Math.max(0, this.trauma - dt * 1.25);
    this.kickAmt = Math.max(0, this.kickAmt - dt * 5);

    cam.getWorldDirection(_f);
    this.moveYaw = Math.atan2(_f.x, _f.z);

    // Framing: keep the golem's highest point (head or raised fists) and the player's feet in view.
    if (locked && this.cineBlend < 0.01) {
      cam.updateMatrixWorld();
      let top = -Infinity;
      for (const c of golem.capsules) {
        for (const q of [c.a, c.b]) {
          _c.copy(q);
          _c.y += c.r * 0.5;
          _c.project(cam);
          if (_c.z < 1 && Math.abs(_c.x) < 1.4) top = Math.max(top, _c.y);
        }
      }
      _c.set(player.pos.x, player.y, player.pos.z).project(cam);
      const feet = _c.y;
      let wantLift = this.lift;
      let wantZoom = this.zoom;
      if (top > 0.8) {
        if (feet > -0.78) wantLift = this.lift + (top - 0.8) * 9;
        wantZoom = this.zoom + (top - 0.8) * (feet > -0.78 ? 6 : 18);
      } else if (top < 0.58) {
        wantLift = this.lift - (0.58 - top) * 4;
        wantZoom = this.zoom - (0.58 - top) * 10;
      }
      if (feet < -0.9) wantLift = this.lift - (-0.9 - feet) * 5;
      this.lift = damp(this.lift, clamp(wantLift, 0, 8), 8, dt);
      this.zoom = damp(this.zoom, clamp(wantZoom, 0, golem.pos.y > 0.5 ? 26 : 16), 6, dt);
    } else {
      this.lift = damp(this.lift, 0, 3, dt);
      this.zoom = damp(this.zoom, 0, 3, dt);
    }
  }

  /** Title-screen orbit around the arena. */
  orbit(dt: number, center: THREE.Vector3, radius: number, height: number, speed: number): void {
    this.time += dt;
    const a = this.time * speed + 2.4;
    this.camera.position.set(center.x + Math.sin(a) * radius, height, center.z + Math.cos(a) * radius);
    this.camera.fov = damp(this.camera.fov, 50, 3, dt);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center.x, center.y, center.z);
    this.camera.getWorldDirection(_f);
    this.moveYaw = Math.atan2(_f.x, _f.z);
  }
}

function closest(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}
