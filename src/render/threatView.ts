import * as THREE from 'three';
import type { Fissure, Hazard, Rock, Spike, Telegraph, Threats, Wave } from '../game/threats';

/*
 * Threat visuals. One colour language:
 *   RED    ring + filling disc  = something is about to land here (slam, rock, meteor, leap, fissure path)
 *   ORANGE crack pattern        = burning ground (dim and flickering while it charges, bright once it burns)
 *   PALE RED ring band          = shockwave travelling outward (roll through it or jump over it)
 */
const RED = new THREE.Color(0xff2e22);
// burning ground is amber-gold, well away from the red of incoming hits
const EMBER = new THREE.Color(0xffa018);
const LAVA = new THREE.Color(0xff8a14);

/** A broken, jittered ring (unit radius): the edge of cracked ground, not a warning circle. */
function brokenRingGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  let seed = 23;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + rnd() * 0.05;
    const a1 = a0 + ((0.35 + rnd() * 0.3) / n) * Math.PI * 2;
    const steps = 4;
    const rIn = 0.9 + rnd() * 0.04;
    for (let k = 0; k < steps; k++) {
      const b0 = a0 + ((a1 - a0) * k) / steps;
      const b1 = a0 + ((a1 - a0) * (k + 1)) / steps;
      const j0 = 1 + (rnd() - 0.5) * 0.05;
      const j1 = 1 + (rnd() - 0.5) * 0.05;
      const p = (a: number, r: number) => [Math.sin(a) * r, 0, Math.cos(a) * r];
      pos.push(...p(b0, rIn * j0), ...p(b0, j0), ...p(b1, j1));
      pos.push(...p(b0, rIn * j0), ...p(b1, j1), ...p(b1, rIn * j1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function crackTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    let cx = x;
    let cy = y;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const nx = cx + Math.cos(a) * (len / steps);
      const ny = cy + Math.sin(a) * (len / steps);
      g.lineWidth = w * (1 - i / (steps + 2));
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(nx, ny);
      g.stroke();
      cx = nx;
      cy = ny;
      a += (rnd() - 0.5) * 0.7;
      if (depth > 0 && rnd() < 0.3) branch(cx, cy, a + (rnd() - 0.5) * 1.6, len * 0.45, w * 0.6, depth - 1);
    }
  };
  for (let i = 0; i < 11; i++) branch(S / 2, S / 2, (i / 11) * Math.PI * 2 + rnd() * 0.4, S * (0.36 + rnd() * 0.12), 7, 2);
  // bright crater centre
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.16);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const RING_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uCenter;
uniform float uR;
uniform float uWidth;
uniform float uAlpha;
varying vec2 vXZ;
void main() {
  float d = length(vXZ - uCenter);
  float band = 1.0 - smoothstep(0.0, uWidth * 0.5, abs(d - uR));
  float core = 1.0 - smoothstep(0.0, uWidth * 0.12, abs(d - uR));
  float a = (band * 0.55 + core * 0.8) * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (1.0 + core * 1.5), a);
}`;
/** Landing warning: a ring with a filling disc, broken up by stone-scale noise, spilling light on the wet floor. */
const TELE_VERT = /* glsl */ `
varying vec2 vP;
varying vec2 vW;
void main() {
  vP = position.xz;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const TELE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uU;
uniform float uLate;
uniform float uTime;
uniform float uSeed;
varying vec2 vP;
varying vec2 vW;
float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1.0, 0.0)), u.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vP);
  float n = tn(vW * 1.7 + uSeed) * 0.6 + tn(vW * 4.3 - uSeed + uTime * 0.6) * 0.4;
  // the ring: a band just inside the danger radius, frayed by the noise
  float ring = 1.0 - smoothstep(0.035, 0.07, abs(r - 0.94 + (n - 0.5) * 0.025));
  float rim = 1.0 - smoothstep(0.0, 0.014, abs(r - 1.0));
  // the timing disc fills from the centre; its front edge burns brightest
  float inside = 1.0 - smoothstep(uU - 0.015, uU + 0.015, r);
  float fill = inside * (0.07 + 0.2 * uU) * (0.55 + 0.9 * n);
  float front = (1.0 - smoothstep(0.0, 0.045, abs(r - uU))) * step(0.03, uU) * (0.35 + 0.4 * uU);
  // light spilling onto the stone beyond the ring
  float halo = step(1.0, r) * exp(-(r - 1.0) * 10.0) * (0.12 + 0.2 * uU);
  float ringA = ring * (0.45 + 0.45 * uU + 0.25 * uLate) * (0.75 + 0.5 * n);
  float rimA = rim * (0.3 + 0.45 * uU + 0.2 * uLate);
  vec3 col = uColor * (ringA + fill + front + halo * (0.7 + 0.6 * n)) + vec3(1.0, 0.84, 0.8) * rimA;
  if (max(col.r, max(col.g, col.b)) < 0.004) discard;
  gl_FragColor = vec4(col, 1.0);
}`;
/** The fissure's path: a dim red danger band with a jagged glowing crack tearing along it. */
const FISSURE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FISSURE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uU;
uniform float uLen;
uniform float uSeed;
uniform float uAlpha;
varying vec2 vUv;
float fh(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
float fn(float x) { float i = floor(x); float f = fract(x); return mix(fh(i), fh(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float along = (1.0 - vUv.y) * uLen;
  float across = vUv.x - 0.5;
  float off = (fn(along * 0.9) - 0.5) * 0.32 + (fn(along * 3.3 + 7.0) - 0.5) * 0.12;
  float d = abs(across - off);
  float crack = 1.0 - smoothstep(0.012, 0.035 + 0.04 * uU, d);
  float glow = exp(-d * 10.0);
  float band = 1.0 - smoothstep(0.3, 0.5, abs(across));
  vec3 col = uColor * (band * (0.14 + 0.18 * uU) + glow * (0.25 + 0.35 * uU)) + vec3(1.0, 0.72, 0.55) * crack * (0.35 + 0.65 * uU);
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;
const BAND_VERT = /* glsl */ `
varying float vH;
varying float vA;
void main() {
  vH = uv.y;
  vA = uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BAND_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying float vH;
varying float vA;
void main() {
  float fade = pow(clamp(1.0 - vH, 0.0, 1.0), 1.6);
  // a bright crest at the height that hits you: jump over it or roll through it
  float crest = 1.0 - smoothstep(0.0, 0.07, abs(vH - 0.8));
  float shimmer = 0.75 + 0.25 * sin(vA * 180.0 + uTime * 9.0);
  float a = (fade * 0.8 + crest * 0.9) * shimmer * uAlpha;
  gl_FragColor = vec4(uColor, a);
}`;

export class ThreatView {
  readonly group = new THREE.Group();
  private readonly hazardMeshes = new Map<Hazard, THREE.Mesh>();
  private readonly waveMeshes = new Map<Wave, THREE.Group>();
  private readonly rockMeshes = new Map<Rock, THREE.Group>();
  private readonly teleMeshes = new Map<Telegraph, THREE.Group>();
  private readonly spikeMeshes = new Map<Spike, THREE.Mesh>();
  private readonly fissureMeshes = new Map<Fissure, THREE.Mesh>();
  private readonly discGeo = new THREE.CircleGeometry(1, 48);
  private readonly ringGeo = new THREE.RingGeometry(0.88, 1, 64);
  private readonly rimGeo = new THREE.RingGeometry(0.975, 1, 64);
  private readonly quadGeo = new THREE.PlaneGeometry(2, 2);
  private readonly teleGeo = new THREE.PlaneGeometry(2.7, 2.7);
  private readonly bandGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
  private rockGeo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 0);
  private meteorGeo: THREE.BufferGeometry | null = null;
  private readonly trailGeo = new THREE.ConeGeometry(0.7, 1, 12, 1, true);
  private spikeGeo: THREE.BufferGeometry = new THREE.ConeGeometry(0.7, 2.6, 5);
  private spikeMat: THREE.Material | null = null;
  private readonly stripGeo = new THREE.PlaneGeometry(1, 1);
  private readonly chevGeo = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, -0.35);
    shape.lineTo(0, 0.25);
    shape.lineTo(0.5, -0.35);
    shape.lineTo(0.5, -0.05);
    shape.lineTo(0, 0.55);
    shape.lineTo(-0.5, -0.05);
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  private readonly hazardEdgeGeo = brokenRingGeometry();
  private readonly crackTex = crackTexture();
  private rockMat: THREE.Material = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95, flatShading: true, emissive: 0x802808, emissiveIntensity: 0.25 });

  /** Use the Blender boulders (unit radius) for thrown rocks and meteors, and a stretched chunk for spikes. */
  setRockLook(rock: THREE.BufferGeometry | null, meteor: THREE.BufferGeometry | null, mat: THREE.Material | null, spike?: THREE.BufferGeometry | null): void {
    if (rock) this.rockGeo = rock;
    this.meteorGeo = meteor;
    if (mat) this.rockMat = mat;
    if (spike) {
      // a shard: the debris chunk stretched upward and pinched at the top
      const g = spike.clone();
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const h = bb.max.y - bb.min.y || 1;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - bb.min.y) / h;
        const pinch = 1 - 0.75 * t;
        pos.setXYZ(i, pos.getX(i) * pinch * 1.3, t * 2.6, pos.getZ(i) * pinch * 1.3);
      }
      g.computeVertexNormals();
      this.spikeGeo = g;
      this.spikeMat = mat;
    }
  }
  private readonly trailMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vK;
      void main() {
        vK = clamp(1.0 + position.y, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vK;
      void main() {
        float a = pow(vK, 2.2) * 0.75;
        vec3 c = mix(vec3(0.55, 0.12, 0.02), vec3(1.0, 0.62, 0.25), vK);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  private time = 0;
  private readonly haloMat = new THREE.SpriteMaterial({
    map: (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,210,150,0.55)');
      grd.addColorStop(0.35, 'rgba(255,150,60,0.22)');
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor() {
    this.discGeo.rotateX(-Math.PI / 2);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.rimGeo.rotateX(-Math.PI / 2);
    this.quadGeo.rotateX(-Math.PI / 2);
    this.teleGeo.rotateX(-Math.PI / 2);
    this.stripGeo.rotateX(-Math.PI / 2);
    this.stripGeo.translate(0, 0, 0.5);
    this.bandGeo.translate(0, 0.5, 0);
    // comet trail: wide end at the rock, tapering away behind it (local -Y = behind)
    this.trailGeo.rotateX(Math.PI);
    this.trailGeo.translate(0, -0.5, 0);
    this.group.name = 'threats';
  }

  private sync<K extends object, V extends THREE.Object3D>(list: K[], map: Map<K, V>, make: (k: K) => V): void {
    for (const [k, v] of map) {
      if (!list.includes(k)) {
        this.group.remove(v);
        v.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (m && m !== this.rockMat && m !== this.trailMat && m !== this.haloMat) m.dispose();
        });
        map.delete(k);
      }
    }
    for (const k of list) {
      if (!map.has(k)) {
        const v = make(k);
        map.set(k, v);
        this.group.add(v);
      }
    }
  }

  update(th: Threats, time: number): void {
    this.time = time;
    this.updateHazards(th);
    this.updateWaves(th);
    this.updateRocks(th);
    this.updateTelegraphs(th);
    this.updateFissures(th);
    this.updateSpikes(th);
  }

  private updateHazards(th: Threats): void {
    this.sync(th.hazards, this.hazardMeshes, (h) => {
      const m = new THREE.Mesh(
        this.discGeo,
        new THREE.MeshBasicMaterial({
          color: h.kind === 'lava' ? LAVA : EMBER,
          alphaMap: this.crackTex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const cold = new THREE.Mesh(
        this.discGeo,
        new THREE.MeshBasicMaterial({ color: 0x0d0a08, alphaMap: this.crackTex, transparent: true, opacity: 0, depthWrite: false }),
      );
      cold.position.y = -0.01;
      cold.renderOrder = 1;
      const edge = new THREE.Mesh(
        this.hazardEdgeGeo,
        new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      edge.position.y = 0.01;
      m.add(edge, cold);
      m.position.copy(h.pos).setY(0.05);
      m.rotation.y = h.seed;
      m.renderOrder = 2;
      return m;
    });
    for (const [h, m] of this.hazardMeshes) {
      const mat = m.material as THREE.MeshBasicMaterial;
      const grow = Math.min(1, h.t / 0.3);
      const fade = Math.min(1, (h.dur - h.t) / 1.2);
      const armed = h.t >= h.arm;
      const warn = Math.max(0, 1 - (h.arm - h.t) / 1.0); // the last second before it burns: fire creeps outward
      // it burns while glowing; in its last 0.3 s it no longer burns (see Threats) and goes dark
      const left = h.dur - h.t;
      const burning = armed && left > 0.3;
      const glow = Math.max(0, Math.min(1, (left - 0.3) / 0.7));
      const edgeMat = (m.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const cold = m.children[1] as THREE.Mesh;
      const coldMat = cold.material as THREE.MeshBasicMaterial;
      const size = h.radius * (0.35 + 0.65 * grow);
      m.scale.setScalar(size);
      // cold cracks (dark, safe) at full size until it burns and again once it stops burning
      coldMat.opacity = burning ? 0 : 0.75 * (armed ? Math.min(1, left / 0.3) : fade);
      if (!burning && !(warn > 0 && !armed)) {
        mat.opacity = 0;
        edgeMat.opacity = 0;
      } else {
        mat.color.copy(h.kind === 'lava' ? LAVA : EMBER);
        const flick = armed ? 0.85 + 0.15 * Math.sin(this.time * 7 + h.seed) : 0.75 + 0.25 * Math.sin(this.time * 26 + h.seed);
        mat.opacity = Math.max(0, armed ? flick * (0.35 + 0.65 * glow) : (0.35 + 0.5 * warn) * flick);
        edgeMat.color.copy(mat.color);
        edgeMat.opacity = armed ? 0.8 * (0.35 + 0.65 * glow) : 0;
      }
      // before it burns, the fire creeps out from the centre and reaches the rim exactly when it ignites
      const spread = armed ? 1 : 0.15 + 0.85 * warn;
      const inv = 1 / Math.max(0.05, spread);
      // the glowing disc is drawn at spread size; its children (edge, cold cracks) stay at full size
      m.scale.setScalar(size * spread);
      edgeMat.opacity *= armed ? 1 : 0;
      (m.children[0] as THREE.Mesh).scale.setScalar(inv);
      cold.scale.setScalar(inv);
    }
  }

  private updateWaves(th: Threats): void {
    this.sync(th.waves, this.waveMeshes, (w) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        this.quadGeo,
        new THREE.ShaderMaterial({
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(0xff9d90) },
            uCenter: { value: new THREE.Vector2(w.center.x, w.center.z) },
            uR: { value: w.r },
            uWidth: { value: w.width },
            uAlpha: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.position.copy(w.center).setY(0.06);
      ring.scale.setScalar(w.maxR + 1);
      const band = new THREE.Mesh(
        this.bandGeo,
        new THREE.ShaderMaterial({
          vertexShader: BAND_VERT,
          fragmentShader: BAND_FRAG,
          uniforms: { uColor: { value: new THREE.Color(0xffb0a4) }, uAlpha: { value: 0.5 }, uTime: { value: 0 } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      band.position.copy(w.center);
      g.add(ring, band);
      return g;
    });
    for (const [w, g] of this.waveMeshes) {
      const ring = g.children[0] as THREE.Mesh;
      const band = g.children[1] as THREE.Mesh;
      const life = 1 - w.r / w.maxR;
      const rm = ring.material as THREE.ShaderMaterial;
      rm.uniforms.uR.value = w.r;
      rm.uniforms.uAlpha.value = 0.5 + 0.5 * life;
      band.scale.set(w.r, w.height * 1.25, w.r);
      const bm = band.material as THREE.ShaderMaterial;
      bm.uniforms.uAlpha.value = 0.8 * life + 0.25;
      bm.uniforms.uTime.value = this.time;
    }
  }

  private updateRocks(th: Threats): void {
    this.sync(th.rocks, this.rockMeshes, (r) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(r.meteor && this.meteorGeo ? this.meteorGeo : this.rockGeo, this.rockMat);
      m.scale.setScalar(r.size);
      m.castShadow = true;
      const trail = new THREE.Mesh(this.trailGeo, this.trailMat);
      const halo = new THREE.Sprite(this.haloMat);
      halo.scale.setScalar(r.size * 4.2);
      g.add(m, trail, halo);
      return g;
    });
    const up = new THREE.Vector3(0, 1, 0);
    for (const [r, g] of this.rockMeshes) {
      const visible = r.t >= (r.meteor ? -0.9 : 0);
      g.visible = visible;
      if (!visible) continue;
      const rock = g.children[0];
      const trail = g.children[1] as THREE.Mesh;
      if (r.t < 0) {
        // meteor hanging in the clouds, glowing, drifting down to its launch point
        g.position.copy(r.pos);
        g.position.y += -r.t * 6;
      } else g.position.copy(r.pos);
      rock.rotation.set(r.spin.x * r.t, r.spin.y * r.t, r.spin.z * r.t);
      const v = r.t < 0 ? new THREE.Vector3(0, -1, 0) : r.vel.clone();
      const speed = v.length();
      if (speed > 0.1) {
        trail.quaternion.setFromUnitVectors(up, v.normalize());
        trail.scale.set(r.size * 0.95, Math.min(7, 1.8 + speed * 0.12), r.size * 0.95);
      }
    }
  }

  private updateTelegraphs(th: Threats): void {
    this.sync(th.telegraphs, this.teleMeshes, (t) => {
      const g = new THREE.Group();
      if (t.kind === 'sector') {
        const lo = Math.min(t.a0!, t.a1!);
        const len = Math.abs(t.a1! - t.a0!);
        const band = new THREE.RingGeometry(t.inner!, t.radius, 48, 1, lo - Math.PI / 2, len);
        band.rotateX(-Math.PI / 2);
        const edge = new THREE.RingGeometry(t.radius - 0.35, t.radius, 64, 1, lo - Math.PI / 2, len);
        edge.rotateX(-Math.PI / 2);
        g.add(
          new THREE.Mesh(band, new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending })),
          new THREE.Mesh(edge, new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })),
        );
        // chevrons along the arc, pointing the way the arm will travel
        const dir = Math.sign(t.a1! - t.a0!) || 1;
        const chevMat = new THREE.MeshBasicMaterial({ color: 0xffd0c0, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        const rMid = (t.inner! + t.radius) / 2;
        const n = 5;
        for (let i = 0; i < n; i++) {
          const a = t.a0! + ((i + 0.5) / n) * (t.a1! - t.a0!);
          const chev = new THREE.Mesh(this.chevGeo, chevMat);
          chev.position.set(Math.sin(a) * rMid, 0.02, Math.cos(a) * rMid);
          // tangent direction of travel around the golem
          chev.rotation.y = a + (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
          chev.scale.setScalar(1.6);
          g.add(chev);
        }
        g.userData.sector = true;
        g.renderOrder = 3;
        return g;
      }
      // one shader: frayed ring, bright rim (readable on lava-lit stone), filling disc, light spill
      const ring = new THREE.Mesh(
        this.teleGeo,
        new THREE.ShaderMaterial({
          vertexShader: TELE_VERT,
          fragmentShader: TELE_FRAG,
          uniforms: {
            uColor: { value: RED.clone() },
            uU: { value: 0 },
            uLate: { value: 0 },
            uTime: { value: 0 },
            uSeed: { value: Math.random() * 50 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      g.add(ring);
      g.renderOrder = 3;
      return g;
    });
    for (const [t, g] of this.teleMeshes) {
      if (g.userData.sector) {
        g.position.copy(t.pos).setY(0.07);
        const u = Math.min(1, t.t / t.dur);
        (((g.children[0] as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.1 + 0.25 * u;
        (((g.children[1] as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * u + (u > 0.7 ? 0.2 * Math.sin(this.time * 40) : 0);
        const chev = g.children[2] as THREE.Mesh | undefined;
        if (chev) (chev.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 12));
        continue;
      }
      g.position.copy(t.pos).setY(0.07);
      const u = Math.min(1, t.t / t.dur);
      // the ring appears slightly larger and tightens onto the danger radius
      const s = t.radius * (1 + 0.25 * (1 - Math.min(1, u * 3)));
      g.scale.setScalar(s);
      const late = u > 0.75 ? 0.5 + 0.5 * Math.sin(this.time * 40) : 0;
      const tu = ((g.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
      tu.uU.value = u;
      tu.uLate.value = late;
      tu.uTime.value = this.time;
    }
  }

  private updateFissures(th: Threats): void {
    this.sync(th.fissures, this.fissureMeshes, (f) => {
      const m = new THREE.Mesh(
        this.stripGeo,
        new THREE.ShaderMaterial({
          vertexShader: FISSURE_VERT,
          fragmentShader: FISSURE_FRAG,
          uniforms: {
            uColor: { value: RED.clone() },
            uU: { value: 0 },
            uLen: { value: f.length },
            uSeed: { value: Math.random() * 40 },
            uAlpha: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      m.position.copy(f.from).addScaledVector(f.dir, f.start).setY(0.08);
      m.rotation.y = Math.atan2(f.dir.x, f.dir.z);
      m.scale.set(1.4, 1, f.length);
      return m;
    });
    for (const [f, m] of this.fissureMeshes) {
      const u = Math.min(1, f.t / Math.max(0.01, f.delay));
      const fu = (m.material as THREE.ShaderMaterial).uniforms;
      fu.uU.value = u;
      fu.uAlpha.value = 0.75 + (f.t < f.delay ? 0.25 * Math.sin(this.time * 30) : 0.25);
      m.scale.x = 0.8 + 2.0 * u;
    }
  }

  private updateSpikes(th: Threats): void {
    this.sync(th.spikes, this.spikeMeshes, (s) => {
      const m = new THREE.Mesh(
        this.spikeGeo,
        this.spikeMat ?? new THREE.MeshStandardMaterial({ color: 0x5a5550, emissive: s.kind === 'lava' ? 0xff4a10 : 0xa03a0c, emissiveIntensity: 1.1, flatShading: true }),
      );
      m.castShadow = true;
      m.position.copy(s.pos);
      m.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 6, (Math.random() - 0.5) * 0.5);
      return m;
    });
    for (const [s, m] of this.spikeMeshes) {
      const up = s.t < 0.12 ? s.t / 0.12 : s.t > 1.0 ? Math.max(0, 1 - (s.t - 1.0) / 0.6) : 1;
      m.scale.set(s.size, s.size * up, s.size);
      m.position.y = -0.2 + 1.2 * s.size * up - 1.2 * s.size * (1 - up);
    }
  }
}
