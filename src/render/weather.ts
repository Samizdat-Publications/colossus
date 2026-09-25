import * as THREE from 'three';

/**
 * The storm: rain streaks and floor splashes (animated entirely on the GPU from a time uniform, world-
 * fixed and wrapped into a box around the camera), and lightning (sky flash, a bolt over the cliffs,
 * an event for the thunder).
 */
const RAIN_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uSpeed;
uniform vec2 uWind;
uniform float uLen;
varying float vFade;
void main() {
  float h = uBox.y;
  float y = h - fract(aSeed.y + uTime * uSpeed / h) * h;
  // world-fixed lattice, wrapped to the copy nearest the camera
  vec2 base = aSeed.xz * uBox.xz;
  vec2 xz = base + uBox.xz * floor((uCenter.xz - base) / uBox.xz + 0.5);
  vec3 dir = normalize(vec3(uWind.x, -uSpeed, uWind.y));
  vec3 p = vec3(xz.x, y, xz.y) - dir * (aEnd * uLen);
  // lean with the wind over the fall
  p.xz += uWind * (h - y) / uSpeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vFade = smoothstep(1.2, 4.0, d) * (1.0 - smoothstep(18.0, 26.0, d)) * (1.0 - aEnd * 0.7) * mix(1.0, 0.3, smoothstep(5.0, 20.0, d));
  gl_Position = projectionMatrix * mv;
}`;
const RAIN_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uFlash;
varying float vFade;
void main() {
  float a = uOpacity * vFade * (1.0 + uFlash * 2.5);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(0.55, 0.64, 0.78), vec3(0.9, 0.95, 1.0), uFlash), a);
}`;

const SPLASH_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uFocus;
uniform float uRadius;
uniform float uScale;
varying float vT;
varying float vNear;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float period = 0.45 + aSeed.x * 0.5;
  float cycle = floor(uTime / period + aSeed.y);
  vT = fract(uTime / period + aSeed.y);
  float a = h1(cycle * 12.9 + aSeed.z * 71.3) * 6.2831;
  float r = sqrt(h1(cycle * 3.7 + aSeed.x * 19.1)) * uRadius;
  vec3 p = vec3(uFocus.x + cos(a) * r, 0.03, uFocus.z + sin(a) * r);
  // stay on the arena floor
  if (length(p.xz) > 44.0) vT = 1.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // small rings; never large blobs right in front of the lens
  gl_PointSize = min(9.0, (0.05 + (0.1 + 0.1 * aSeed.z) * vT) * uScale / max(0.1, -mv.z));
  vNear = 1.0 - smoothstep(5.0, 13.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SPLASH_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vT;
varying float vNear;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  // a thin expanding ring, squashed onto the floor by the view (good enough at a distance)
  float ring = smoothstep(0.15, 0.0, abs(r - 0.75)) ;
  float a = ring * (1.0 - vT) * uOpacity * vNear;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.72, 0.8, 0.92, a);
}`;

export class Weather {
  readonly group = new THREE.Group();
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly splashMat: THREE.ShaderMaterial;
  private readonly bolt: THREE.Mesh;
  private readonly boltMat: THREE.ShaderMaterial;
  private nextStrike = 3 + Math.random() * 4;
  private strikeT = -1;
  private strikeStrength = 1;
  /** 0..1 light from the current lightning flash */
  flash = 0;
  /** rain strength 0..1 */
  rain = 1;
  onStrike: ((strength: number, distance: number) => void) | null = null;

  constructor() {
    // rain streaks
    const drops = 2600;
    const seeds = new Float32Array(drops * 2 * 3);
    const ends = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const sx = Math.random();
      const sy = Math.random();
      const sz = Math.random();
      for (let e = 0; e < 2; e++) {
        seeds.set([sx, sy, sz], (i * 2 + e) * 3);
        ends[i * 2 + e] = e;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(drops * 2 * 3), 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(34, 22, 34) },
        uSpeed: { value: 24 },
        uWind: { value: new THREE.Vector2(3.5, 2.5) },
        uLen: { value: 0.85 },
        uOpacity: { value: 0.32 },
        uFlash: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
    });
    const rain = new THREE.LineSegments(rg, this.rainMat);
    rain.frustumCulled = false;
    rain.renderOrder = 6;
    this.group.add(rain);

    // splashes on the floor around the warrior
    const n = 700;
    const ss = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) ss[i] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.splashMat = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: { uTime: { value: 0 }, uFocus: { value: new THREE.Vector3() }, uRadius: { value: 16 }, uScale: { value: 600 }, uOpacity: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
    });
    const splashes = new THREE.Points(sg, this.splashMat);
    splashes.frustumCulled = false;
    splashes.renderOrder = 6;
    this.group.add(splashes);

    // lightning bolt (rebuilt for every strike)
    this.boltMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aAcross;
        varying float vAcross;
        void main() { vAcross = aAcross; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float opacity;
        varying float vAcross;
        void main() {
          float d = abs(vAcross - 0.5) * 2.0;
          float core = exp(-d * d * 30.0);
          float glow = exp(-d * d * 3.5) * 0.45;
          vec3 col = vec3(0.82, 0.88, 1.0) * (core * 3.2 + glow);
          gl_FragColor = vec4(col * opacity, 1.0);
        }`,
      uniforms: { opacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.frustumCulled = false;
    this.group.add(this.bolt);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.splashMat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** Force a strike now (phase changes, the golem's death). */
  strike(strength = 1): void {
    this.nextStrike = 0;
    this.strikeStrength = strength;
  }

  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3, frequency = 1): void {
    const u = this.rainMat.uniforms;
    u.uTime.value = time;
    u.uCenter.value.copy(camera.position);
    u.uOpacity.value = 0.24 * this.rain;
    this.splashMat.uniforms.uTime.value = time;
    this.splashMat.uniforms.uFocus.value.copy(focus);
    this.splashMat.uniforms.uOpacity.value = 0.26 * this.rain;
    // lightning
    this.nextStrike -= dt * frequency;
    if (this.nextStrike <= 0 && this.strikeT < 0) {
      this.strikeT = 0;
      this.nextStrike = 4.5 + Math.random() * 8;
      this.buildBolt(camera);
      const dist = 60 + Math.random() * 90;
      this.onStrike?.(this.strikeStrength, dist);
      this.strikeStrength = 0.7 + Math.random() * 0.3;
    }
    if (this.strikeT >= 0) {
      this.strikeT += dt;
      const t = this.strikeT;
      const pulse = (t0: number, k: number) => (t >= t0 ? Math.exp(-(t - t0) * k) : 0);
      this.flash = Math.min(1.2, pulse(0, 9) + 0.7 * pulse(0.09, 12) + 0.9 * pulse(0.24, 7));
      this.boltMat.uniforms.opacity.value = Math.min(1, this.flash * 1.4);
      if (t > 1.2) {
        this.strikeT = -1;
        this.flash = 0;
        this.boltMat.uniforms.opacity.value = 0;
      }
    }
    u.uFlash.value = this.flash;
  }

  private buildBolt(camera: THREE.Camera): void {
    // somewhere over the cliffs in front of the camera, so the player sees it
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    const a = Math.atan2(f.x, f.z) + (Math.random() - 0.5) * 1.4;
    const r = 110 + Math.random() * 60;
    let x = Math.sin(a) * r;
    let z = Math.cos(a) * r;
    let y = 120;
    const pts: THREE.Vector3[] = [new THREE.Vector3(x, y, z)];
    while (y > 32) {
      y -= 6 + Math.random() * 10;
      x += (Math.random() - 0.5) * 14;
      z += (Math.random() - 0.5) * 14;
      pts.push(new THREE.Vector3(x, Math.max(30, y), z));
    }
    // a ribbon facing the camera, with two or three thinner forks splitting off the main channel
    const pos: number[] = [];
    const across: number[] = [];
    const ribbon = (line: THREE.Vector3[], w: number) => {
      for (let i = 0; i < line.length - 1; i++) {
        const p0 = line[i];
        const p1 = line[i + 1];
        const side = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(camera.position, p0)).normalize().multiplyScalar(w * (1 - i / line.length) + 0.25);
        const a0 = p0.clone().add(side);
        const b0 = p0.clone().sub(side);
        const a1 = p1.clone().add(side);
        const b1 = p1.clone().sub(side);
        pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z);
        pos.push(b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
        across.push(0, 1, 0, 1, 1, 0);
      }
    };
    ribbon(pts, 2.6);
    const forks = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < forks; k++) {
      const from = pts[1 + Math.floor(Math.random() * Math.max(1, pts.length - 3))];
      const fork: THREE.Vector3[] = [from.clone()];
      const dx = (Math.random() - 0.5) * 18;
      const dz = (Math.random() - 0.5) * 18;
      let fy = from.y;
      for (let j = 0; j < 3 + Math.floor(Math.random() * 3); j++) {
        fy -= 5 + Math.random() * 7;
        const last = fork[fork.length - 1];
        fork.push(new THREE.Vector3(last.x + dx * 0.35 + (Math.random() - 0.5) * 6, Math.max(30, fy), last.z + dz * 0.35 + (Math.random() - 0.5) * 6));
      }
      ribbon(fork, 1.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
    this.bolt.geometry.dispose();
    this.bolt.geometry = g;
  }
}
