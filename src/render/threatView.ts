import * as THREE from 'three';
import type { Fissure, Hazard, Rock, Spike, Telegraph, Threats, Wave } from '../game/threats';

/*
 * Threat visuals. One colour language:
 *   RED    ring + filling disc  = something is about to land here (slam, rock, meteor, leap, fissure path)
 *   ORANGE crack pattern        = burning ground (dim and flickering while it charges, bright once it burns)
 *   PALE   ring band            = shockwave travelling outward (roll through it or jump over it)
 */
const RED = new THREE.Color(0xff2e22);
const EMBER = new THREE.Color(0xff7418);
const LAVA = new THREE.Color(0xff5410);

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
  float shimmer = 0.75 + 0.25 * sin(vA * 180.0 + uTime * 9.0);
  float a = fade * shimmer * uAlpha;
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
  private readonly quadGeo = new THREE.PlaneGeometry(2, 2);
  private readonly bandGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
  private readonly rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly trailGeo = new THREE.ConeGeometry(0.7, 1, 12, 1, true);
  private readonly spikeGeo = new THREE.ConeGeometry(0.7, 2.6, 5);
  private readonly stripGeo = new THREE.PlaneGeometry(1, 1);
  private readonly crackTex = crackTexture();
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x57524c, roughness: 0.92, flatShading: true, emissive: 0xff4a10, emissiveIntensity: 0.35 });
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
      grd.addColorStop(0, 'rgba(255,190,120,0.9)');
      grd.addColorStop(0.35, 'rgba(255,110,40,0.35)');
      grd.addColorStop(1, 'rgba(255,80,20,0)');
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
    this.quadGeo.rotateX(-Math.PI / 2);
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
      const warn = Math.max(0, 1 - (h.arm - h.t) / 0.8); // last 0.8 s before burning
      if (!armed && warn <= 0) {
        // cold cracks: dark fissures in the stone, safe to stand on
        mat.blending = THREE.NormalBlending;
        mat.color.setRGB(0.05, 0.04, 0.035);
        mat.opacity = 0.75 * fade;
      } else {
        mat.blending = THREE.AdditiveBlending;
        mat.color.copy(h.kind === 'lava' ? LAVA : EMBER);
        const flick = armed ? 0.85 + 0.15 * Math.sin(this.time * 7 + h.seed) : 0.5 + 0.5 * Math.sin(this.time * 26 + h.seed);
        mat.opacity = Math.max(0, (armed ? 1 : 0.35 * warn) * flick * fade);
      }
      m.scale.setScalar(h.radius * (0.35 + 0.65 * grow));
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
            uColor: { value: new THREE.Color(0xffc080) },
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
          uniforms: { uColor: { value: new THREE.Color(0xffe2b8) }, uAlpha: { value: 0.5 }, uTime: { value: 0 } },
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
      rm.uniforms.uAlpha.value = 0.35 + 0.65 * life;
      band.scale.set(w.r, w.height * 1.25, w.r);
      const bm = band.material as THREE.ShaderMaterial;
      bm.uniforms.uAlpha.value = 0.55 * life + 0.1;
      bm.uniforms.uTime.value = this.time;
    }
  }

  private updateRocks(th: Threats): void {
    this.sync(th.rocks, this.rockMeshes, (r) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(this.rockGeo, this.rockMat);
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
        g.userData.sector = true;
        g.renderOrder = 3;
        return g;
      }
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const fill = new THREE.Mesh(
        this.discGeo,
        new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      g.add(ring, fill);
      g.renderOrder = 3;
      return g;
    });
    for (const [t, g] of this.teleMeshes) {
      if (g.userData.sector) {
        g.position.copy(t.pos).setY(0.07);
        const u = Math.min(1, t.t / t.dur);
        (((g.children[0] as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.1 + 0.25 * u;
        (((g.children[1] as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * u + (u > 0.7 ? 0.2 * Math.sin(this.time * 40) : 0);
        continue;
      }
      g.position.copy(t.pos).setY(0.07);
      const u = Math.min(1, t.t / t.dur);
      // the ring appears slightly larger and tightens onto the danger radius
      const s = t.radius * (1 + 0.25 * (1 - Math.min(1, u * 3)));
      g.scale.setScalar(s);
      const ring = g.children[0] as THREE.Mesh;
      const fill = g.children[1] as THREE.Mesh;
      const late = u > 0.75 ? 0.5 + 0.5 * Math.sin(this.time * 40) : 0;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.45 * u + 0.25 * late;
      fill.scale.setScalar(Math.max(0.01, u));
      (fill.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.22 * u;
    }
  }

  private updateFissures(th: Threats): void {
    this.sync(th.fissures, this.fissureMeshes, (f) => {
      const m = new THREE.Mesh(
        this.stripGeo,
        new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.position.copy(f.from).addScaledVector(f.dir, f.start).setY(0.08);
      m.rotation.y = Math.atan2(f.dir.x, f.dir.z);
      m.scale.set(1.4, 1, f.length);
      return m;
    });
    for (const [f, m] of this.fissureMeshes) {
      const u = Math.min(1, f.t / Math.max(0.01, f.delay));
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.25 + 0.5 * u + (f.t < f.delay ? 0.25 * Math.sin(this.time * 30) : 0);
      m.scale.x = 0.8 + 2.0 * u;
    }
  }

  private updateSpikes(th: Threats): void {
    this.sync(th.spikes, this.spikeMeshes, (s) => {
      const m = new THREE.Mesh(
        this.spikeGeo,
        new THREE.MeshStandardMaterial({ color: 0x5a5550, emissive: s.kind === 'lava' ? 0xff4a10 : 0xa03a0c, emissiveIntensity: 1.1, flatShading: true }),
      );
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
