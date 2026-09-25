import * as THREE from 'three';

const N = 14;

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
    this.pos = new Float32Array(N * 2 * 3);
    this.alpha = new Float32Array(N * 2);
    const index: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const edge = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) edge[i * 2 + 1] = 1; // 0 at the base vertex, 1 at the tip vertex
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
          // faint near the hilt, brightest along the path of the blade's edge
          float k = pow(vEdge, 1.6) * 0.75 + smoothstep(0.82, 1.0, vEdge) * 0.9;
          gl_FragColor = vec4(uColor * (0.6 + 0.8 * smoothstep(0.85, 1.0, vEdge)), vA * k);
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
    if (active) {
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
    const life = heavy ? 0.22 : 0.19;
    this.mat.uniforms.uColor.value.setHex(heavy ? 0xffd9a8 : 0xdde8ff);
    let any = false;
    for (let i = 0; i < N; i++) {
      const k = i < this.count ? Math.max(0, 1 - this.age[i] / life) * (1 - i / N) : 0;
      if (k > 0) any = true;
      this.pos.set([this.base[i].x, this.base[i].y, this.base[i].z], i * 6);
      this.pos.set([this.tip[i].x, this.tip[i].y, this.tip[i].z], i * 6 + 3);
      this.alpha[i * 2] = k * 0.12;
      this.alpha[i * 2 + 1] = k * (heavy ? 0.42 : 0.4);
    }
    if (!active && !any) this.count = 0;
    this.mesh.visible = any;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
