import * as THREE from 'three';

/**
 * Brazier fire: camera-facing quads with a noise-driven flame shader (additive), one per brazier.
 */
const VERT = /* glsl */ `
varying vec2 vUv;
uniform float uSize;
uniform vec2 uShape;
void main() {
  vUv = uv;
  // billboard: expand the quad in view space around the object's origin
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += (uv - vec2(0.5, 0.0)) * uShape * uSize;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform float uGain;
uniform vec3 uTint;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 uv = vUv;
  float t = uTime * 1.6 + uSeed;
  float n = noise(vec2(uv.x * 4.0, uv.y * 3.0 - t * 2.2)) * 0.6 + noise(vec2(uv.x * 9.0 + 3.0, uv.y * 7.0 - t * 3.7)) * 0.4;
  // teardrop: wide at the bottom, tapering, bent by the noise and the wind
  float x = (uv.x - 0.5 - (n - 0.5) * 0.35 * uv.y - 0.08 * uv.y) * 2.0;
  float width = (1.0 - uv.y) * (0.55 + 0.45 * n);
  float shape = smoothstep(width, width * 0.35, abs(x)) * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.45, uv.y + n * 0.25);
  vec3 hot = vec3(1.0, 0.92, 0.65);
  vec3 mid = vec3(1.0, 0.5, 0.12);
  vec3 cold = vec3(0.7, 0.14, 0.03);
  float k = clamp(shape * 1.4 - uv.y * 0.6, 0.0, 1.0);
  vec3 col = mix(cold, mix(mid, hot, smoothstep(0.55, 0.95, k)), smoothstep(0.1, 0.6, k));
  float a = shape;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * uTint * (1.5 + k * 2.0) * uGain, a);
}`;

export class Flames {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor(spots: THREE.Vector3[], size = 1.3) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0.5, 0);
    // uv already runs 0..1; the vertex shader builds the billboard from uv
    spots.forEach((p, i) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 7.31 }, uSize: { value: size }, uGain: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uShape: { value: new THREE.Vector2(0.7, 1.35) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p);
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.group.add(m);
      this.mats.push(mat);
    });
  }

  update(time: number): void {
    for (const m of this.mats) m.uniforms.uTime.value = time;
  }
}

/** Flames for burning ground: a fixed pool of billboards, placed each frame on the patches that burn. */
export class FirePool {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.ShaderMaterial[] = [];

  constructor(n = 24) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0.5, 0);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        // ground fire: dimmer and deeper orange than a brazier, so it reads as burning floor and not as torches
        uniforms: { uTime: { value: 0 }, uSeed: { value: i * 3.17 + 1.3 }, uSize: { value: 1 }, uGain: { value: 0.5 }, uTint: { value: new THREE.Vector3(1, 0.62, 0.34) }, uShape: { value: new THREE.Vector2(1.0, 1.1) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = 5;
      m.visible = false;
      this.group.add(m);
      this.meshes.push(m);
      this.mats.push(mat);
    }
  }

  /** spots: flame base positions and heights in metres; the rest of the pool hides. */
  update(time: number, spots: { x: number; z: number; size: number }[]): void {
    this.meshes.forEach((m, i) => {
      const s = spots[i];
      m.visible = !!s && s.size > 0.05;
      if (!m.visible) return;
      m.position.set(s.x, 0.02, s.z);
      this.mats[i].uniforms.uSize.value = s.size;
      this.mats[i].uniforms.uTime.value = time;
    });
  }
}
