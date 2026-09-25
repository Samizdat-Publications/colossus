import * as THREE from 'three';
import type { Fissure, Hazard, Rock, Spike, Telegraph, Threats, Wave } from '../game/threats';

/** Primitive visuals for the threats (greybox; replaced by proper effects later). */
export class ThreatView {
  readonly group = new THREE.Group();
  private readonly hazardMeshes = new Map<Hazard, THREE.Mesh>();
  private readonly waveMeshes = new Map<Wave, THREE.Mesh>();
  private readonly rockMeshes = new Map<Rock, THREE.Mesh>();
  private readonly teleMeshes = new Map<Telegraph, THREE.Group>();
  private readonly spikeMeshes = new Map<Spike, THREE.Mesh>();
  private readonly fissureMeshes = new Map<Fissure, THREE.Mesh>();
  private readonly stripGeo = new THREE.PlaneGeometry(1, 1);
  private readonly discGeo = new THREE.CircleGeometry(1, 40);
  private readonly ringGeo = new THREE.RingGeometry(0.9, 1, 56);
  private readonly wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true);
  private readonly rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private readonly spikeGeo = new THREE.ConeGeometry(0.7, 2.6, 5);
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 0.9, flatShading: true });

  constructor() {
    this.discGeo.rotateX(-Math.PI / 2);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.stripGeo.rotateX(-Math.PI / 2);
    this.stripGeo.translate(0, 0, 0.5);
    this.wallGeo.translate(0, 0.5, 0);
    this.group.name = 'threats';
  }

  private sync<K extends object, V extends THREE.Object3D>(list: K[], map: Map<K, V>, make: (k: K) => V): void {
    for (const [k, v] of map) {
      if (!list.includes(k)) {
        this.group.remove(v);
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
    this.sync(th.hazards, this.hazardMeshes, (h) => {
      const m = new THREE.Mesh(
        this.discGeo,
        new THREE.MeshBasicMaterial({ color: h.kind === 'lava' ? 0xff5a10 : 0xd0501a, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      m.position.copy(h.pos).setY(0.04);
      m.scale.setScalar(h.radius);
      return m;
    });
    for (const [h, m] of this.hazardMeshes) {
      const mat = m.material as THREE.MeshBasicMaterial;
      const grow = Math.min(1, h.t / 0.35);
      const fade = Math.min(1, (h.dur - h.t) / 1);
      const armed = h.t >= h.arm;
      const warm = armed ? 1 : 0.15 + 0.35 * Math.max(0, 1 - (h.arm - h.t) / 1.2);
      mat.opacity = (0.35 + 0.15 * Math.sin(time * (armed ? 6 : 14) + h.seed)) * fade * warm;
      m.scale.setScalar(h.radius * (0.4 + 0.6 * grow));
    }

    this.sync(th.waves, this.waveMeshes, () => {
      const m = new THREE.Mesh(
        this.wallGeo,
        new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      return m;
    });
    for (const [w, m] of this.waveMeshes) {
      m.position.copy(w.center);
      m.scale.set(w.r, w.height, w.r);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - w.r / w.maxR) + 0.15;
    }

    this.sync(th.rocks, this.rockMeshes, (r) => {
      const m = new THREE.Mesh(this.rockGeo, this.rockMat);
      m.scale.setScalar(r.size);
      m.castShadow = true;
      return m;
    });
    for (const [r, m] of this.rockMeshes) {
      m.visible = r.t >= 0;
      m.position.copy(r.pos);
      m.rotation.set(r.spin.x * r.t, r.spin.y * r.t, r.spin.z * r.t);
    }

    this.sync(th.telegraphs, this.teleMeshes, (t) => {
      const g = new THREE.Group();
      const color = t.kind === 'meteor' || t.kind === 'rock' ? 0xff8a3a : 0xff5030;
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const fill = new THREE.Mesh(
        this.discGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      g.add(ring, fill);
      return g;
    });
    for (const [t, g] of this.teleMeshes) {
      g.position.copy(t.pos).setY(0.06);
      g.scale.setScalar(t.radius);
      const u = Math.min(1, t.t / t.dur);
      const ring = g.children[0] as THREE.Mesh;
      const fill = g.children[1] as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * u + 0.15 * Math.sin(time * 18);
      fill.scale.setScalar(Math.max(0.01, u));
      (fill.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.2 * u;
    }

    this.sync(th.fissures, this.fissureMeshes, (f) => {
      const m = new THREE.Mesh(
        this.stripGeo,
        new THREE.MeshBasicMaterial({ color: f.kind === 'lava' ? 0xff5a18 : 0xff7a2a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      m.position.copy(f.from).addScaledVector(f.dir, f.start).setY(0.07);
      m.rotation.y = Math.atan2(f.dir.x, f.dir.z);
      m.scale.set(1.4, 1, f.length);
      return m;
    });
    for (const [f, m] of this.fissureMeshes) {
      const u = Math.min(1, f.t / Math.max(0.01, f.delay));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.55 * u + 0.2 * Math.sin(time * 30);
      m.scale.x = 0.6 + 1.2 * u;
    }

    this.sync(th.spikes, this.spikeMeshes, (s) => {
      const m = new THREE.Mesh(
        this.spikeGeo,
        new THREE.MeshStandardMaterial({ color: 0x5a5550, emissive: s.kind === 'lava' ? 0xff4a10 : 0x802a08, emissiveIntensity: 1.2, flatShading: true }),
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
