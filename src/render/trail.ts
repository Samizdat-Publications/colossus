import * as THREE from 'three';

const N = 14;
/** drawn segments per recorded gap: at 60 fps a fast swing moves the blade far between frames, and straight
 * quads between samples read as flat triangles */
const SUB = 4;
const M = (N - 1) * SUB + 1;

function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return out.set(
    0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  );
}
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * A ribbon behind the sword blade while it swings: the last N base/tip positions, fading with age.
 * Reads the swing (arc, speed, reach) at a glance, like a motion blur.
 */
export class SwordTrail {
  readonly mesh: THREE.Mesh;
  private readonly base: THREE.Vector3[] = [];
  private readonly tip: THREE.Vector3[] = [];
  private readonly age: number[] = [];
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private count = 0;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly local0 = new THREE.Vector3(0, 0, 0.15);
  private readonly local1 = new THREE.Vector3(0, 0, 1.26);

  constructor(private readonly sword: THREE.Object3D) {
    for (let i = 0; i < N; i++) {
      this.base.push(new THREE.Vector3());
      this.tip.push(new THREE.Vector3());
      this.age.push(99);
    }
    this.pos = new Float32Array(M * 2 * 3);
    this.alpha = new Float32Array(M * 2);
    const index: number[] = [];
    for (let i = 0; i < M - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const edge = new Float32Array(M * 2);
    for (let i = 0; i < M; i++) edge[i * 2 + 1] = 1; // 0 at the base vertex, 1 at the tip vertex
    this.geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    this.geo.setIndex(index);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aEdge;
        varying float vA;
        varying float vEdge;
        void main() { vA = aAlpha; vEdge = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        varying float vEdge;
        void main() {
          if (vA < 0.01) discard;
          // faint near the hilt, brightest along the path of the blade's edge, soft everywhere (no hard sheet)
          float k = pow(vEdge, 2.2) * 0.7 + smoothstep(0.7, 1.0, vEdge) * 0.6;
          gl_FragColor = vec4(uColor * (0.95 + 1.0 * smoothstep(0.8, 1.0, vEdge)), vA * k);
        }`,
      uniforms: { uColor: { value: new THREE.Color(0xdde8ff) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** A point along the blade (in the sword's local space) to world space, in place. */
  bladePoint(local: THREE.Vector3): THREE.Vector3 {
    this.sword.updateWorldMatrix(true, false);
    return local.applyMatrix4(this.sword.matrixWorld);
  }

  /** active: the blade is in an attack's strike window. heavy swings leave a warmer, longer trail. */
  update(dt: number, active: boolean, heavy: boolean): void {
    for (let i = 0; i < N; i++) this.age[i] += dt;
    // a paused or frozen frame (dt 0) must not record: re-recording the same blade position every frozen
    // frame collapsed the whole ribbon onto the blade
    if (active && dt > 0) {
      // shift and record
      for (let i = N - 1; i > 0; i--) {
        this.base[i].copy(this.base[i - 1]);
        this.tip[i].copy(this.tip[i - 1]);
        this.age[i] = this.age[i - 1];
      }
      this.sword.updateWorldMatrix(true, false);
      this.base[0].copy(this.local0).applyMatrix4(this.sword.matrixWorld);
      this.tip[0].copy(this.local1).applyMatrix4(this.sword.matrixWorld);
      this.age[0] = 0;
      // a fresh swing: forget where the last one ended (the quad between them drew a long streak)
      if (this.count === 0) {
        for (let i = 1; i < N; i++) {
          this.base[i].copy(this.base[0]);
          this.tip[i].copy(this.tip[0]);
        }
      }
      this.count = Math.min(N, this.count + 1);
    }
    const life = heavy ? 0.3 : 0.26;
    // warm steel (the rain is cool blue-white, so a pale blue trail vanished into it)
    this.mat.uniforms.uColor.value.setHex(heavy ? 0xffc27a : 0xfff0d2);
    let any = false;
    const last = Math.max(0, Math.min(N, this.count) - 1);
    for (let j = 0; j < M; j++) {
      const i = Math.min(N - 2, Math.floor(j / SUB));
      const f = j / SUB - i;
      const i0 = Math.max(0, i - 1);
      const i2 = Math.min(N - 1, i + 1);
      const i3 = Math.min(N - 1, i + 2);
      catmull(this.base[i0], this.base[i], this.base[i2], this.base[i3], f, _a);
      catmull(this.tip[i0], this.tip[i], this.tip[i2], this.tip[i3], f, _b);
      const age = this.age[i] + (this.age[i2] - this.age[i]) * f;
      const u = j / SUB / Math.max(1, last); // 0 at the blade, 1 at the tail
      // fades with age and toward the tail: bright at the blade, gone at the far end
      const k = j / SUB <= last ? Math.max(0, 1 - age / life) * Math.pow(Math.max(0, 1 - u), 1.6) : 0;
      if (k > 0) any = true;
      this.pos.set([_a.x, _a.y, _a.z], j * 6);
      this.pos.set([_b.x, _b.y, _b.z], j * 6 + 3);
      this.alpha[j * 2] = k * 0.2;
      this.alpha[j * 2 + 1] = k * (heavy ? 0.9 : 0.8);
    }
    if (!active && !any) this.count = 0;
    this.mesh.visible = any;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
