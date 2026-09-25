import * as THREE from 'three';

/**
 * A pool of point sprites updated on the CPU (a few thousand at most) and drawn in one call.
 * Two pools are used: soft "dust" (normal blending) and "glow" (additive: sparks, embers, shards).
 */
export interface Emit {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size: number;
  /** size at end of life, as a multiple of size */
  grow?: number;
  color: THREE.Color;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** particles that rise (embers) flicker */
  flicker?: number;
  /** bounce off the floor (sparks) */
  bounce?: boolean;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG_SOFT = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a *= a * a;
  if (a * vColor.a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a * vColor.a);
}`;
const FRAG_GLOW = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float core = smoothstep(0.35, 0.0, r);
  float halo = smoothstep(1.0, 0.0, r) * 0.45;
  float a = (core + halo) * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * (1.0 + core * 1.5), a);
}`;

export class Particles {
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly grow: Float32Array;
  private readonly baseCol: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly flicker: Float32Array;
  private readonly bounce: Uint8Array;
  private next = 0;
  private readonly geo: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(capacity: number, kind: 'soft' | 'glow') {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.baseCol = new Float32Array(capacity * 4);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.flicker = new Float32Array(capacity);
    this.bounce = new Uint8Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: kind === 'soft' ? FRAG_SOFT : FRAG_GLOW,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: kind === 'soft' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = kind === 'soft' ? 4 : 5;
  }

  /** Match the sprite scale to the viewport (called on resize). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(e: Emit): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([e.pos.x, e.pos.y, e.pos.z], i * 3);
    this.vel.set([e.vel.x, e.vel.y, e.vel.z], i * 3);
    this.life[i] = e.life;
    this.maxLife[i] = e.life;
    this.baseSize[i] = e.size;
    this.grow[i] = e.grow ?? 1;
    this.baseCol.set([e.color.r, e.color.g, e.color.b, e.alpha ?? 1], i * 4);
    this.gravity[i] = e.gravity ?? 0;
    this.drag[i] = e.drag ?? 0;
    this.flicker[i] = e.flicker ?? 0;
    this.bounce[i] = e.bounce ? 1 : 0;
  }

  private clearOn = false;
  private readonly clearA = new THREE.Vector3();
  private readonly clearB = new THREE.Vector3();

  /** Thin out particles near the line from the camera (a) to the warrior (b), so dust never hides them. */
  setClearLine(a: THREE.Vector3 | null, b?: THREE.Vector3): void {
    this.clearOn = !!a && !!b;
    if (a && b) {
      this.clearA.copy(a);
      this.clearB.copy(b);
    }
  }

  update(dt: number, time: number): void {
    const ax = this.clearA.x;
    const ay = this.clearA.y;
    const az = this.clearA.z;
    const sx = this.clearB.x - ax;
    const sy = this.clearB.y - ay;
    const sz = this.clearB.z - az;
    const sl2 = sx * sx + sy * sy + sz * sz || 1;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]); // 1 -> 0
      const j = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - this.gravity[i] * dt;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.02) {
        this.pos[j + 1] = 0.02;
        if (this.bounce[i]) {
          this.vel[j + 1] *= -0.35;
          this.vel[j] *= 0.6;
          this.vel[j + 2] *= 0.6;
        } else this.vel[j + 1] = 0;
      }
      const age = 1 - k;
      this.size[i] = this.baseSize[i] * (1 + (this.grow[i] - 1) * age);
      const fl = this.flicker[i] > 0 ? 1 - this.flicker[i] * 0.5 * (1 + Math.sin(time * 23 + i * 1.7)) : 1;
      // fade in over the first 10 % of life, out over the rest
      const fade = Math.min(1, age * 10) * Math.min(1, k * 1.6);
      const c = i * 4;
      this.col[c] = this.baseCol[c];
      this.col[c + 1] = this.baseCol[c + 1];
      this.col[c + 2] = this.baseCol[c + 2];
      let clear = 1;
      if (this.clearOn) {
        const px = this.pos[j] - ax;
        const py = this.pos[j + 1] - ay;
        const pz = this.pos[j + 2] - az;
        const u = Math.min(1, Math.max(0, (px * sx + py * sy + pz * sz) / sl2));
        const d = Math.hypot(px - sx * u, py - sy * u, pz - sz * u);
        const w = Math.min(1, Math.max(0, (d - 0.7) / 1.3));
        clear = 0.12 + 0.88 * w * w * (3 - 2 * w);
      }
      this.col[c + 3] = this.baseCol[c + 3] * fade * fl * clear;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
  }
}

/** Solid rock chunks (instanced) that fly, bounce, settle and sink away. */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly p: THREE.Vector3[] = [];
  private readonly v: THREE.Vector3[] = [];
  private readonly q: THREE.Quaternion[] = [];
  private readonly w: THREE.Vector3[] = [];
  private readonly s: number[] = [];
  private readonly life: number[] = [];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly dq = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly one = new THREE.Vector3();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, capacity = 140) {
    this.n = capacity;
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.p.push(new THREE.Vector3());
      this.v.push(new THREE.Vector3());
      this.q.push(new THREE.Quaternion());
      this.w.push(new THREE.Vector3());
      this.s.push(0);
      this.life.push(0);
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, size: number, life = 3): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i].copy(pos);
    this.v[i].copy(vel);
    this.q[i].setFromEuler(this.e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    this.w[i].set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    this.s[i] = size;
    this.life[i] = life;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const p = this.p[i];
      const v = this.v[i];
      v.y -= 22 * dt;
      p.addScaledVector(v, dt);
      const r = this.s[i] * 0.5;
      if (p.y < r) {
        p.y = r;
        if (Math.abs(v.y) > 1.5) {
          v.y *= -0.3;
          v.x *= 0.55;
          v.z *= 0.55;
          this.w[i].multiplyScalar(0.5);
        } else {
          v.set(v.x * 0.8, 0, v.z * 0.8);
          this.w[i].multiplyScalar(0.85);
        }
      }
      this.dq.setFromEuler(this.e.set(this.w[i].x * dt, this.w[i].y * dt, this.w[i].z * dt));
      this.q[i].multiply(this.dq);
      const shrink = Math.min(1, this.life[i] / 0.6);
      this.one.setScalar(this.s[i] * Math.max(0, shrink));
      this.m.compose(p, this.q[i], this.one);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) {
      this.life[i] = 0;
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
